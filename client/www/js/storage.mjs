import * as m_log from "./log.mjs";
import * as m_popup from "./popup.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.warn, "storage");

export const e_data_type = Object.freeze({
  string: "e_data_type::string",
  integer: "e_data_type::integer",
});

export const e_store_access = Object.freeze({
  existing_entries: "e_store_access::existing_entries",
  add_entries: "e_store_access::add_entries",
  remove_entries: "e_store_access::remove_entries",
  set_selection: "e_store_access::set_selection",
  clear_selection: "e_store_access::clear_selection",
});

export const e_entry_access = Object.freeze({
  denied: "e_entry_access::denied",
  read_write: "e_entry_access::read_write",
  read_only: "e_entry_access::read_only",
});

export const e_change_type = Object.freeze({
  property_changed: "e_change_type::property_changed",
  entry_added: "e_change_type::entry_added",
  entry_removed: "e_change_type::entry_removed",
  entries_cleared: "e_change_type::entries_cleared",
});

const k_db_name = "bytesized|spiff";
const k_db_version = 1;

let g_init_promise = null;
let g_setup_db_promises = null;
let g_db = null;

// The name of the store in which we store the versioning information for other data stores.
const k_store_version_store_name = "store_version";
const k_store_version_store_name_prop = "store";
const k_store_version_version_prop = "version";

const k_store_entry_selection_key_prop = "key";
const k_store_entry_selection_value_prop = "value";

async function init() {
  if (g_init_promise != null) {
    return g_init_promise;
  }
  k_log.debug("init - start");
  g_init_promise = new Promise(async (resolve, reject) => {
    k_log.debug("init - Waiting for permission to use persistent storage");
    try {
      await navigator.storage.persist();
    } catch (ex) {
      k_log.warn("init - Storage persistence failed (not https?)");
    }

    k_log.info("init - Opening database");
    const request = window.indexedDB.open(k_db_name, k_db_version);
    request.addEventListener("error", event => {
      k_log.error("init - Open error", event);
      m_popup.show({
        title: "Error Opening Database",
        message:
          `Initializing database resulted in error code: ${event.target.errorCode}. See console ` +
          `for more details.`,
        buttons: [],
      });
      reject(new Error("Error Initializing Database"));
    });
    request.addEventListener("blocked", event => {
      k_log.error("init - Database blocked from opening", event);
      m_popup.show({
        title: "Blocked From Initializing Database",
        message:
          "Need to upgrade the database, but it is currently open in another tab, so we are " +
          "blocked from doing so",
        buttons: [],
      });
      reject(new Error("Blocked From Initializing Database"));
    });
    request.addEventListener("upgradeneeded", setup_database);
    request.addEventListener("success", async event => {
      k_log.info("init - Database opened successfully", event);

      if (g_setup_db_promises != null) {
        k_log.debug("init - Waiting for database setup to complete");
        let setup_results = await Promise.allSettled(g_setup_db_promises);
        g_setup_db_promises = null;
        for (const setup_result of setup_results) {
          if (setup_result.status == "rejected") {
            k_log.error("init - Database setup failed", setup_result.reason);
            m_popup.show({
              title: "Error Initializing Database",
              message:
                `Initializing database failed with error: ${setup_result.reason}. See console ` +
                `for more details.`,
              buttons: [],
            });
            reject(setup_result.reason);
            return;
          }
        }
        k_log.debug("init - Database setup complete");
      }

      g_db = event.target.result;
      g_db.addEventListener("error", error_event => {
        k_log.error("init - Database fall-through error", error_event);
        m_popup.show({
          title: "Unexpected Database Error",
          message: "Unhandled database error caught. See console for details",
          buttons: [],
        });
      });

      resolve();
    });
  });
  return g_init_promise;
}

// This probably won't be used anywhere, but is useful for manual testing.
export async function clobber() {
  k_log.error("clobber - Start");
  try {
    await init();
  } catch (ex) {}
  try {
    g_db.close();
  } catch (ex) {
    k_log.error("clobber - Failed to close database", ex);
  }

  k_log.error("clobber - Deleting database.");
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(k_db_name);
    request.addEventListener("error", event => {
      k_log.error("clobber - Failed to delete database:", event);
      reject(new Error("Failed to delete database"));
    })
    request.addEventListener("success", event => {
      k_log.error("clobber - Database deleted");
      resolve();
    });
  });
}

async function until_state(event_target, event_name) {
  return new Promise(resolve => {
    let callback = event => {
      event_target.removeEventListener(event_name, callback);
      resolve(event);
    };
    event_target.addEventListener(event_name, callback);
  });
}

async function until_complete(event_target) {
  return until_state(event_target, "complete");
}

async function until_success(event_target) {
  return until_state(event_target, "success");
}

/**
 * Ideally this would set up the database using setup data from modules' store descriptions, but
 * initializing this module would require initializing all those modules. And having those
 * descriptions describe how version upgrades should work seems unnecessarily complicated. So I'm
 * just going to make the lousy decision to have the database schema live in a different place from
 * the store descriptions.
 * It's necessary for this work to happen here because you can only change the database schema in
 * a `versionchange` transaction.
 */
function setup_database(event) {
  k_log.info("setup_database - Start", event);
  const db = event.target.result;
  let setup_error_handler = event => {
    k_log.error("setup_database - database setup error", event);
    m_popup.show({
      title: "Error Setting Up Database",
      message: "Failed to set up database. See the console for more details.",
      buttons: [],
    });
  };
  db.addEventListener("error", setup_error_handler);

  const store_setup_promise = until_complete(event.target.transaction);
  g_setup_db_promises = [store_setup_promise];

  if (event.oldVersion < 1) {
    db.createObjectStore(k_store_version_store_name, {keyPath: k_store_version_store_name_prop});
  }

  db.removeEventListener("error", setup_error_handler);
  k_log.debug("setup_database - Setup complete.");
}

/**
 * Creates and returns a storage object describing a table of data.
 *
 * Note: Non-persisted data properties are deep frozen before storage, but not copied. This
 *       prevents data in storage from being accidentally modified from outside. But it also means
 *       that if non-persisted data properties are objects that are intended to be changed, a
 *       copy needs to be made before storage.
 *
 * @param store_name
 *        A unique name for the store to construct. If any data is to be persisted to the disk
 *        disk, this store name must match the store name used in `setup_database`.
 * @param store_version
 *        An integer version of the data schema being used by this store.
 * @param description
 *        An object describing the structure of the data using these properties:
 *          entry_properties
 *            Required. An object describing the properties that each entry in the table will have.
 *            The properties in the `entry_properties` object should each be a property of the
 *            table entry. The corresponding values should be objects describing the table entries.
 *            These are the valid properties that these values can contain:
 *              persist
 *                Optional - defaults to `false`. If `true`, the property value will be persisted
 *                into the database.
 *              public_access
 *                Optional - defaults to `e_entry_access::denied`. Does nothing if
 *                `description.split_public != true`. Can be set to a value of `e_entry_access`.
 *                Specifies whether or not this property is accessible in the public storage object
 *                returned.
 *          generated_key
 *            Optional - defaults to `false`. A value of `true` indicates that this store uses
 *            `autoIncrement: true`.
 *          key
 *            Required. The entry property to be used as the lookup key. If data is being
 *            persisted, this should match the object store's `keyPath`.
 *          selection
 *            Optional. If specified, it means that an entry in the table can be the currently
 *            selected entry. If set, this should be an object that may contain these properties:
 *              additional_properties
 *                Optional. If specified, additional properties will be set for the selected entry. 
 *                If set, this should be an object with the same format as
 *                `description.entry_properties`. The `persist` property may be used ONLY if
 *                `description.selection.persist_to_store` is specified.
 *              persist_to_store
 *                Optional. If set, the selection will be persisted to the database. In that case,
 *                it should be set to the name of the data store that the data should be stored in.
 *                This store should have been created with
 *                `keyPath: k_store_entry_selection_key_prop`.
 *              public_access
 *                Optional - defaults to `e_entry_access::denied`. Does nothing if
 *                `description.split_public != true`. Can be set to a value of `e_entry_access`.
 *                Specifies whether or not the `selected` property is accessible in the public
 *                storage object returned. If this is set to `e_entry_access::denied`, neither
 *                `selected` nor any of its properties will be accessible to the public, regardless
 *                of the properties' `public_access` values.
 *          split_public
 *            Optional. If specified, should be an array of `e_store_access` values indicating
 *            what sort of access should be possible through the public module.
 *            If not set or set to an empty array, a bare, single object is returned. If set to
 *            an array with length > 0, an array of two objects are returned. The first will be the
 *            regular storage object that would normally be returned. The second will be the public
 *            storage object whose access will be determined by the specified `e_store_access`
 *            values and the `public_access` values set by the property definitions.
 * @returns
 *        Either returns a bare, single object or an array of two objects, depending on the value
 *        of `description.split_public`. In the latter case, the first object will be the regular,
 *        "private" storage object and the second object will be the public storage object.
 *        The returned private storage object will have the following properties (the public one
 *        will be limited as specified in `description`):
 *          add(entry) [async]
 *            Adds the specified entry to the database.
 *            On success, the entry will be updated with they key that received upon inserting
 *            (which should only result in a change to the entry if the store uses `autoIncrement`)
 *          add_change_listener(listener)
 *            Takes an instance of `ChangeListener` as an argument.
 *            This specifies what sorts of data changes should cause the callback to be invoked and
 *            also provides the callback itself. See the `ChangeListener` definition and
 *            constructor for details.
 *            When the callback is invoked, it will be passed an object describing the change that
 *            has occurred. The object will have these properties:
 *              type
 *                An instance of `e_change_type` indicating what kind of change happened.
 *              selection_changed
 *                A `true` value indicates that the selection has changed to a different entry.
 *                Note that all properties of the entry are considered to have changed when the
 *                selection changes, even if the new and old values of the property happen to be
 *                the same.
 *              selection_set
 *                Only set if `selection_changed == true`. `true` if there is currently a selection
 *                set, `false` if there is not.
 *              entry
 *                An `entry_copy` object describing the new state of the relevant entry.
 *                If `type` indicates that an entry was added or removed, this will be the entry
 *                that was added or removed.
 *                If `selection_changed == true` and `type != e_change_type.entry_removed`, this
 *                will describe the new selection. This property will not be defined if the
 *                selection was cleared.
 *                Note that this entry will NOT be present when
 *                `type == e_change_type.entries_cleared`.
 *          clear() [async]
 *            Removes all entries from the database.
 *          clear_selection() [async]
 *            Sets no entry as being selected.
 *            Throws an error if `selection` is not present in the `description`.
 *          delete(key) [async]
 *            Takes the key of an entry and deletes it from the database.
 *          get(key) [async]
 *            Returns an `entry_copy` corresponding to the specified `key`, or `null` if there is
 *            nothing associated with that key.
 *          get_all() [async]
 *            Returns an array of `entry_copy`s representing all the store's data.
 *          get_selection() [async]
 *            Returns an `entry_copy` describing the selected entry or `null` if nothing is
 *            selected.
 *            Throws an error if `selection` is not present in the `description`.
 *          get_selection_key() [async]
 *            Returns the key of the selected entry or `null` if nothing is selected.
 *            Throws an error if `selection` is not present in the `description`.
 *          iter(query, direction)
 *            Optionally takes the same arguments as `IDBObjectStore::openCursor`
 *            https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/openCursor
 *            Returns an asynchronous iterator suitable for being used in a `for await...of`
 *            statement. Each of the iter values will be an `entry_copy`.
 *          remove_change_listener(listener)
 *            Takes a `ChangeListener` that was previously passed to `add_change_listener` and
 *            removes it as a listener so that it will no longer be called on any data changes
 *            (unless it is passed to `add_change_listener` again).
 *            This only removes the listener once.
 *            Returns `true` if a listener was found and removed, else `false`.
 *          set_selection(partial_entry) [async]
 *            `partial_entry` may contain any combination of properties that a selected entry can
 *            have, but must contain the key. The selection will be set to 
 *            Throws an error if `selection` is not present in the `description`.
 *          update(partial_entry) [async]
 *            Takes a partial entry with the only requirement being that the key property be set.
 *            Updates whatever properties on the value are set and leaves the others at their
 *            present value.
 *            Returns the resulting entry as an `entry_copy`.
 *            Note that which property observers are fired is dependent on what properties are
 *            passed in, not on which actually changed.
 *
 *        Many of the methods described above give access to a data entry. These entries come in
 *        different formats:
 *          entry_copy
 *            This is an object with properties matching those in `description.entry_properties`.
 *            Each property is read-only and directly contains the relevant data. That is to say,
 *            an `entry_copy` looks something like: `{prop1: value1}`.
 *          entry_cursor
 *            Originally I was going to have `iter` return this type but it is presently unused.
 *            In theory, we can mutate the database while we iterate it, but (a) it makes sense
 *            to have two separate methods for this since we can open a read-only transaction if
 *            we aren't going to mutate the database and (b) I just don't actually need the
 *            functionality at the moment. But in theory it will probably look like
 *            `{value: ..., async update(): ..., async delete(): ...}`
 *            if I ever do decide to implement it.
 */
export async function create(store_name, store_version, description) {
  k_log.debug("create - Creating data store", store_name);
  deep_freeze(description);

  await init();

  let transaction = g_db.transaction([k_store_version_store_name], "readwrite");
  let store = transaction.objectStore(k_store_version_store_name);
  let request = store.get(k_store_version_store_name_prop);
  k_log.debug("create - Looking up the previous store version for", store_name);
  await until_success(request);
  let previous_store_version;
  if (request.result) {
    previous_store_version = request.result[k_store_version_version_prop];
    k_log.debug("create - Store:", store_name, "Stored data version:", previous_store_version,
                "Program data version", store_version);
  } else {
    k_log.debug("Stored version information for store", store_name, "not found. Assuming " +
                "data is current version:", store_version);
    // It is currently assumed that there is no process for upgrading an empty database to a new
    // version.
    previous_store_version = store_version;
  }
  if (previous_store_version > store_version) {
    k_log.error("create - Downgrade error when initializing data for store", store_name);
    m_popup.show({
      title: "Application Out of Date",
      message:
        `Attempted to initialize storage for the ${store_name} store, but the current version ` +
        `is ${store_version} and the version in the database is ${previous_store_version}.`,
      buttons: [],
    });
    throw new Error("Application out of date compared to data version");
  }
  if (previous_store_version < store_version) {
    k_log.error("create - Need to upgrade data for store", store_name);
    m_popup.show({
      title: "Data Migration Not Implemented",
      message:
        `We need to migrate the data for store ${store_name} from version ` +
        `${previous_store_version} to version ${store_version}, but data migration hasn't ` +
        `been implemented yet.`,
      buttons: [],
    });
    throw new Error("Data migration not implemented");
  }

  let store_version_record = {
    [k_store_version_store_name_prop]: store_name,
    [k_store_version_version_prop]: store_version,
  };
  store = transaction.objectStore(k_store_version_store_name);
  request = store.put(store_version_record);
  k_log.debug("create - Writing store version information for store", store_name);
  await until_complete(transaction);
  k_log.debug("create - store version information written");

  const private_store = new StoreObject(store_name, description);
  if (!description.split_public || description.split_public.length < 1) {
    return private_store;
  }

  const public_store = new PublicStoreObject(private_store);
  return [private_store, public_store];
}

/**
 * Used to describe when a data listener ought to fire.
 *
 * If a caller only wants to be notified of a selection change event, the proper way to specify
 * this is by setting `selected_only = true` and adding the entry's key property to `properties`.
 *
 * Note that a property listener with `selected_only == true` can fire for events with types other
 * than `e_change_type.property_changed` because removing the selected entry results in the
 * selection changing.
 */
export class ChangeListener {
  constructor(init_values = undefined) {
    // If `true`, we only care about the selected entry. If `false`, we care about any entry.
    // Note that a selection change event can only be witnessed if `selected_only == true`.
    this.selected_only = false;
    // If `true`, we care about changes to any of the entry's properties.
    this.any_property = false;
    // Any property name added to the `properties` array means that we care if the entry's value
    // for that property changes.
    this.properties = [];
    // If `true`, we care if an entry was added.
    // This field has no effect if `selected_only == true`.
    this.add = false;
    // If `true`, we care if an entry was removed. Note that this includes receiving events for
    // both `e_change_type.entry_removed` and `e_change_type.entries_cleared`.
    // This field has no effect if `selected_only == true`.
    this.remove = false;
    // The callback itself. See the documentation for the return value of `create` for a
    // description of the argument passed to the callback.
    this.callback = null;
    // This is typically not set by the constructor, but by a `PublicStoreObject` to indicate
    // that the listener's access is limited.
    this.public_context = false;

    if (init_values) {
      Object.assign(this, init_values);
    }
  }
}

function deep_freeze(object) {
  const properties = Reflect.ownKeys(object);
  for (const property of properties) {
    const value = object[property];
    if ((value && typeof value === "object") || typeof value === "function") {
      deep_freeze(value);
    }
  }
  return Object.freeze(object);
}

/**
 * Documentation for this class's interface is in the return value documentation for `create`.
 */
class StoreObject {
  #store_name;
  #description;
  #listeners;
  // #session_store uses external keys as property names but (assuming the store doesn't use the
  // database) stores storage keys in the stored objects' key properties.
  #session_store;
  #use_database;
  #session_selection_store;
  #next_id;

  #store_public_access;
  #public_properties;
  #publicly_writable_properties;


  constructor(store_name, description) {
    this.#store_name = store_name;
    this.#description = description;
    this.#listeners = [];
    this.#session_store = {};
    this.#use_database = StoreObject.#need_database(description);
    this.#session_selection_store = {};
    this.#next_id = 1;

    this.#store_public_access = new Set();
    this.#public_properties = new Set();
    this.#publicly_writable_properties = new Set();
    if (this.#description.split_public && this.#description.split_public.length > 0) {
      this.#store_public_access = new Set(this.#description.split_public);
      if (this.#store_public_access.has(e_store_access.existing_entries)) {
        const add_public_entries_to_sets = property_descriptions => {
          for (const property in property_descriptions) {
            const property_description = property_descriptions[property];
            if (property_description.public_access == e_entry_access.read_write) {
              this.#public_properties.add(property);
              this.#publicly_writable_properties.add(property);
            } else if (property_description.public_access == e_entry_access.read_only) {
              this.#public_properties.add(property);
            }
          }
        };
        add_public_entries_to_sets(description.entry_properties);
        if (description?.selection?.additional_properties) {
          add_public_entries_to_sets(description.selection.additional_properties);
        }
      }
    }
  }

  static #need_database(description) {
    for (const property of Object.values(description.entry_properties)) {
      if (property.persist) {
        return true;
      }
    }
    if (!("selection" in description)) {
      return false;
    }
    return "persist_to_store" in description.selection;
  }

  /**
   * @param entry
   *        Takes an entry ready to be used externally (deep frozen and with an externally
   *        formatted key).
   * @returns
   *        A frozen entry with publicly accessible properties only.
   */
  #make_public_entry(entry) {
    let public_entry = {};
    for (const property of this.#public_properties) {
      if (property in entry) {
        public_entry[property] = entry[property];
      }
    }
    Object.freeze(public_entry);
    return public_entry;
  }

  /**
   * @param entry
   *        Takes an entry and removes (in place) properties that are not accessible in a public
   *        context.
   * @param public_context
   *        If `false`, this function has no effect
   */
  #maybe_convert_to_public_entry(entry, public_context) {
    for (const property in entry) {
      if (!this.#public_properties.has(property)) {
        delete entry[property];
      }
    }
  }

  /**
   * Throws an exception on an attempt to write to a property that should not be written to in the
   * given context.
   *
   * @param partial_entry
   *        A partial entry intended to update an entry.
   * @param public_context
   *        If `true`, this evaluated in a public context
   */
  #check_writable(partial_entry, public_context) {
    if (!public_context) {
      return;
    }
    const can_change_entries = this.#store_public_access.has(e_store_access.existing_entries);
    for (const property in partial_entry) {
      if (!(
        property == this.#description.key ||
        (can_change_entries && this.#publicly_writable_properties.has(property))
      )) {
        k_log.error("Access Error: Cannot write property", property, "from public context");
        throw new Error(`Access Error: Cannot write property "${property}" from public context`);
      }
    }
  }

  #fire_listeners(event_selection_fn, callback_arg, public_entry = undefined) {
    deep_freeze(callback_arg);

    let public_callback_arg = {
      type: callback_arg.type,
      selection_changed: callback_arg.selection_changed
    };
    if ("selection_set" in callback_arg) {
      public_callback_arg.selection_set = callback_arg.selection_set;
    }
    if ("entry" in callback_arg) {
      public_callback_arg.entry = public_entry ?? this.#make_public_entry(callback_arg.entry);
    }

    for (const listener of this.#listeners) {
      if (event_selection_fn(listener)) {
        try {
          listener.callback(listener.public_context ? public_callback_arg : callback_arg);
        } catch (ex) {
          k_log.error("Listener threw exception", ex);
        }
      }
    }
  }

  /**
   * It is generally preferably to me for entry keys to be strings. Objects use string properties.
   * DOM elements have string attributes. Having the keys be strings in the first place simplifies
   * work when we want to use keys in contexts like that. But generated keys are integers. So, if
   * we are using generated keys, we are going to convert them back and forth when putting them
   * in and retrieving them from the database.
   */
  #key_as_storage_format(external_key) {
    if (!this.#description.generated_key) {
      return external_key;
    }
    let storage_key = parseInt(external_key, 10);
    if (isNaN(storage_key)) {
      k_log.error("Generated key ", external_key, " should be an integer but it isn't.");
      throw new Error(`Generated key "${external_key}" should be an integer but it isn't.`);
    }
    return storage_key;
  }
  #key_as_external_format(storage_key) {
    return this.#description.generated_key ? storage_key.toString() : storage_key;
  }

  /**
   * Splits the entry into four objects and returns them. In order, they are:
   *  - persistent, non-selected-specific storage
   *  - persistent, selected-specific storage
   *  - non-persistent, non-selected-specific storage
   *  - non-persistent, selected-specific storage
   * If the key field is present, it will be converted to storage format.
   */
  #split_persisted_and_selection_storage(entry) {
    const persisted_general = {};
    const persisted_select = {};
    const non_persisted_general = {};
    const non_persisted_select = {};
    for (const property in entry) {
      const value = 
        property == this.#description.key ? this.#key_as_storage_format(entry[property])
                                          : entry[property];
      if (property in this.#description.entry_properties) {
        if (this.#description.entry_properties[property].persist) {
          persisted_general[property] = value;
        } else {
          non_persisted_general[property] = value;
        }
      } else {
        if (this.#description.selection.additional_properties[property].persist) {
          persisted_select[property] = value
        } else {
          non_persisted_select[property] = value;
        }
      }
    }
    return [persisted_general, persisted_select, non_persisted_general, non_persisted_select];
  }

  #maybe_transaction({store = true, selection_store = false, write = false} = {}) {
    if (!this.#use_database) {
      return [undefined, undefined];
    }
    let stores = [];
    if (store) {
      stores.push(this.#store_name);
    }
    if (selection_store && this.#use_selection_database()) {
      stores.push(this.#description.selection.persist_to_store);
    }
    if (stores.length == 0) {
      return [undefined, undefined];
    }
    const mode = write ? "readwrite" : "readonly";
    const transaction = g_db.transaction(stores, mode);
    const complete_promise = until_complete(transaction);
    return [transaction, complete_promise];
  }

  async add(entry, public_context = false) {
    k_log.info("Store:", this.#store_name, "Adding", entry);

    if (public_context && !this.#store_public_access.has(e_store_access.add_entries)) {
      k_log.error("No access to adding entries from a public context");
      throw new Error("No access to adding entries from a public context");
    }

    const [persisted, persisted_select, non_persisted, non_persisted_select] =
      this.#split_persisted_and_selection_storage(entry);

    k_log.debug("To persist", persisted);
    k_log.debug("Non-persisted", non_persisted);

    let storage_key;
    if (this.#use_database) {
      const [transaction, complete_promise] = this.#maybe_transaction({write: true});
      const object_store = transaction.objectStore(this.#store_name);
      const request = object_store.add(persisted);
      k_log.debug("Waiting for add transaction to complete");
      await complete_promise;
      k_log.debug("Add transaction complete", request);
      storage_key = request.result;
    } else if (this.#description.generated_key) {
      storage_key = this.#next_id;
      this.#next_id += 1;

      non_persisted[this.#description.key] = storage_key;
    } else {
      storage_key = this.#key_as_storage_format(entry[this.#description.key]);
    }

    const external_key = this.#key_as_external_format(storage_key);
    entry[this.#description.key] = external_key;
    this.#session_store[external_key] = deep_freeze(non_persisted);

    k_log.debug("Firing add listeners");
    let listener_arg = {type: e_change_type.entry_added, selection_changed: false, entry};
    this.#fire_listeners(events => !events.selected_only && events.add, listener_arg);
    k_log.debug("Add listeners fired");
  }

  /**
   * @param storage_key
   *        An entry key in storage format.
   * @param external_key
   *        The same entry key in external format.
   * @param transaction
   *        The transaction to use. This argument will be ignored if `!this.#use_database`.
   * @returns
   *        The retrieved entry or `null` if the key has no corresponding value. The key in the
   *        entry will be in external format.
   */
  async #get_with_transaction(storage_key, external_key, transaction) {
    let request;
    if (this.#use_database) {
      const object_store = transaction.objectStore(this.#store_name);
      request = object_store.get(storage_key);
      k_log.debug("Waiting to get value for", storage_key);
      await until_success(request);
      if (request.result == undefined) {
        k_log.debug("Get succeeded, but no value was set");
        // Technically there could still be something in `this.#sessionStore`, but using the
        // database and only writing a partial value to the session storage is currently not
        // supported.
        return null;
      }
      k_log.debug("Get succeeded");
    }

    let entry = {};
    if (external_key in this.#session_store) {
      Object.assign(entry, this.#session_store[external_key]);
    }
    if (this.#use_database) {
      Object.assign(entry, request.result);
    }
    entry[this.#description.key] = this.#key_as_external_format(entry[this.#description.key]);
    k_log.debug("Value retrieved:", entry);
    return entry;
  }

  async get(external_key, public_context = false) {
    k_log.debug("Store:", this.#store_name, "Getting value for", external_key);

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    const [transaction, complete_promise] = this.#maybe_transaction();
    const storage_key = this.#key_as_storage_format(external_key);
    const entry = await this.#get_with_transaction(storage_key, external_key, transaction);

    if (this.#use_database) {
      await complete_promise;
    }
    if (entry == null) {
      return entry;
    }
    this.#maybe_convert_to_public_entry(entry, public_context);
    return deep_freeze(entry);
  }

  #use_selection_database() {
    return this.#use_database && Boolean(this.#description.selection.persist_to_store);
  }

  /**
   * @param transaction
   *        The transaction to use. This argument will be ignored if `!this.#use_database`.
   *        This transaction must be opened with read access to the selection store.
   * @returns
   *        The key of the currently selected entry, in storage format, or `null` if there is no
   *        selection.
   */
  async #get_selected_key_with_transaction(transaction) {
    if (!this.#use_selection_database()) {
      return this.#session_selection_store[this.#description.key];
    }
    const object_store = transaction.objectStore(this.#description.selection.persist_to_store);
    const request = object_store.get(this.#description.key);
    k_log.debug("Waiting to get selection key");
    await until_success(request);
    if (request.result == undefined) {
      k_log.debug("Nothing selected");
      return null;
    }
    k_log.debug("Got selection key", request.result);
    return request.result[k_store_entry_selection_value_prop];
  }

  /**
   * Note that this doesn't fire selection changed events, which ought to be done once the
   * transaction has completed.
   *
   * @param transaction
   *        The transaction to use. This argument will be ignored if `!this.#use_database`.
   *        This transaction must be opened with write access to the selection store.
   */
  #clear_selected_with_transaction(transaction) {
    this.#session_selection_store = {};
    if (!this.#use_selection_database()) {
      return;
    }
    const object_store = transaction.objectStore(this.#description.selection.persist_to_store);
    const request = object_store.clear();
  }

  async clear(public_context = false) {
    k_log.info("Store:", this.#store_name, "Clearing");

    if (public_context && !this.#store_public_access.has(e_store_access.remove_entries)) {
      k_log.error("No access to remove entries from a public context");
      throw new Error("No access to remove entries from a public context");
    }

    const [transaction, complete_promise] =
      this.#maybe_transaction({selection_store: true, write: true});

    let selection_changed = false;
    if (this.#description.selection) {
      const selected_key = await this.#get_selected_key_with_transaction(transaction);
      if (selected_key != null) {
        if (public_context && !this.#store_public_access.has(e_store_access.clear_selection)) {
          k_log.error("No access to change selection from a public context");
          throw new Error("No access to change selection from a public context");
        }

        this.#clear_selected_with_transaction(transaction);
        selection_changed = true;
      }
    }

    if (this.#use_database) {
      const object_store = transaction.objectStore(this.#store_name);
      object_store.clear();
      k_log.debug("Waiting for clear transaction to complete");
      await complete_promise;
      k_log.debug("Clear transaction complete");
    }

    this.#session_store = {};

    k_log.debug("Firing clear listeners");
    let listener_arg = {type: e_change_type.entries_cleared, selection_changed};
    if (selection_changed) {
      listener_arg.selection_set = false;
    }
    this.#fire_listeners(
      events => (!events.selected_only && events.remove) ||
                (selection_changed && events.selected_only),
      listener_arg
    );
    k_log.debug("Clear listeners fired");
  }

  async delete(external_key, public_context = false) {
    k_log.info("Store:", this.#store_name, "Deleting value for", external_key);

    if (public_context && !this.#store_public_access.has(e_store_access.remove_entries)) {
      k_log.error("No access to remove entries from a public context");
      throw new Error("No access to remove entries from a public context");
    }

    const storage_key = this.#key_as_storage_format(external_key);

    const [transaction, complete_promise] =
      this.#maybe_transaction({selection_store: true, write: true});

    const entry = await this.#get_with_transaction(storage_key, external_key, transaction);

    let selection_changed = false;
    if (this.#description.selection) {
      const selected_key = await this.#get_selected_key_with_transaction(transaction);
      if (selected_key == storage_key) {
        if (public_context && !this.#store_public_access.has(e_store_access.clear_selection)) {
          k_log.error("No access to change selection from a public context");
          throw new Error("No access to change selection from a public context");
        }

        this.#clear_selected_with_transaction(transaction);
        selection_changed = true;
      }
    }

    if (this.#use_database) {
      const object_store = transaction.objectStore(this.#store_name);
      const request = object_store.delete(storage_key);
      k_log.debug("Waiting for delete transaction to complete");
      await complete_promise;
      k_log.debug("Delete transaction completed");
    }

    delete this.#session_store[external_key];

    k_log.debug("Firing delete listeners");
    let listener_arg = {type: e_change_type.entry_removed, selection_changed, entry};
    if (selection_changed) {
      listener_arg.selection_set = false;
    }
    this.#fire_listeners(
      events => (!events.selected_only && events.remove) ||
                (selection_changed && events.selected_only),
      listener_arg
    );
    k_log.debug("Delete listeners fired");
  }

  async get_all(public_context = false) {
    k_log.debug("Store:", this.#store_name, "Getting all values");

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    if (!this.#use_database) {
      return Object.values(this.#session_store);
    }

    const [transaction, complete_promise] = this.#maybe_transaction();
    const object_store = transaction.objectStore(this.#store_name);
    const request = object_store.getAll();
    k_log.debug("Waiting for all values to be retrieved");
    await complete_promise;
    k_log.debug("All values retrieved");
    const db_values = request.result;

    let return_values = [];
    for (const db_value of db_values) {
      let entry = {};
      const storage_key = db_value[this.#description.key];
      const external_key = this.#key_as_external_format(storage_key);
      if (external_key in this.#session_store) {
        Object.assign(entry, this.#session_store[external_key]);
      }
      Object.assign(entry, db_value);
      entry[this.#description.key] = external_key;
      this.#maybe_convert_to_public_entry(entry, public_context);
      deep_freeze(entry);
      return_values.push(entry);
    }
    k_log.debug("All values merged with non-persistent data", return_values);
    return return_values;
  }

  /**
   * Updates the entry with the id specified.
   *
   * @param partial_entry
   *        An object containing the properties to update and the values to update them to. Should
   *        contain the relevant key property formatted as an external key.
   * @param storage_key
   *        The key in `partial_entry`, formatted as a storage key.
   * @param selected_key
   *        The key of the currently selected database entry.
   * @param transaction
   *        The transaction to use. This argument will be ignored if `!this.#use_database`.
   *        This transaction must be opened with write access to the main store and the selection
   *        store.
   * @param complete_promise
   *        A Promise that resolves when the transaction is complete.
   * @returns
   *        An array containing two elements. The first is the entry represented as it will be
   *        when the transaction completes, with the key formatted as an external key. The second
   *        is a Promise that will resolve when the update is complete including the session store
   *        (which isn't updated until after the transaction completes). We don't want to close the
   *        transaction in this function, so the session store will not have been updated when this
   *        function returns (if we are using the database).
   */
  async #update_with_transaction(partial_entry, storage_key, selected_key, transaction,
                                 complete_promise) {
    const external_key = partial_entry[this.#description.key];

    let entry = await this.#get_with_transaction(storage_key, external_key, transaction);

    if (entry == null) {
      k_log.error("Attempted to update store", this.#store_name, ", key", storage_key,
                  "but no such key can be found");
      throw new Error(`Attempted to update store "${this.#store_name}", key "${storage_key}" ` +
                      `but no such key can be found`);
    }

    Object.assign(entry, partial_entry);

    const [persisted, persisted_select, non_persisted, non_persisted_select] =
      this.#split_persisted_and_selection_storage(entry);
    k_log.debug("To persist general", persisted);
    k_log.debug("To persist selection-specific", persisted_select);
    k_log.debug("Non-persisted general", non_persisted);
    k_log.debug("Non-persisted selection-specific", non_persisted_select);

    if (this.#use_database) {
      const object_store = transaction.objectStore(this.#store_name);
      object_store.put(persisted);

      if (storage_key == selected_key && this.#use_selection_database()) {
        const object_store = transaction.objectStore(this.#description.selection.persist_to_store);
        for (const property in persisted_select) {
          const update_object = {
            [k_store_entry_selection_key_prop]: property,
            [k_store_entry_selection_value_prop]: persisted_select[property],
          };
          object_store.put(update_object);
        }
      }
    }

    const update_session_store = () => {
      this.#session_store[external_key] = deep_freeze(non_persisted);
      if (storage_key == selected_key) {
        Object.assign(this.#session_selection_store, non_persisted_select);
      }
    };

    if (!this.#use_database) {
      update_session_store();
      return [entry, Promise.resolve()];
    }

    return [entry, complete_promise.then(update_session_store)];
  }

  async update(partial_entry, public_context = false) {
    k_log.info("Store:", this.#store_name, "Updating:", partial_entry);

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    this.#check_writable(partial_entry, public_context);

    const storage_key = this.#key_as_storage_format(partial_entry[this.#description.key]);
    const [transaction, complete_promise] =
      this.#maybe_transaction({selection_store: true, write: true});

    let selection_updated = false;
    let selected_key = null;
    if (this.#description.selection) {
      selected_key = await this.#get_selected_key_with_transaction(transaction);
      if (selected_key == storage_key) {
        selection_updated = true;
      }
    }

    const [entry, update_complete_promise] = await this.#update_with_transaction(
      partial_entry, storage_key, selected_key, transaction, complete_promise
    );

    if (this.#use_database) {
      k_log.debug("Waiting for update transaction to complete");
      await complete_promise;
      k_log.debug("Update transaction complete");
    }

    k_log.debug("Waiting for update action to complete");
    await update_complete_promise;
    k_log.debug("Update action complete");

    const properties_changed = new Set(Object.keys(partial_entry));
    properties_changed.delete(this.#description.key);

    k_log.debug("Firing property change listeners");
    let listener_arg = {type: e_change_type.property_changed, selection_changed: false, entry};
    this.#fire_listeners(
      events => (!events.selected_only || selection_updated) &&
                (
                  events.any_property ||
                  events.properties.findIndex(p => properties_changed.has(p)) != -1
                ),
      listener_arg
    );
    k_log.debug("Property change listeners fired");
    return deep_freeze(entry);
  }

  iter(query, direction, public_context = false) {
    k_log.debug("Store:", this.#store_name, "Starting iteration");

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    const [transaction, complete_promise] = this.#maybe_transaction();
    let request;
    let cursor_promise;
    let external_keys;
    if (this.#use_database) {
      const object_store = transaction.objectStore(this.#store_name);
      request = object_store.openCursor(query, direction);
      cursor_promise = until_success(request);
    } else {
      external_keys = Object.keys(this.#session_store);
    }
    
    const next_fn = async () => {
      let result;
      if (this.#use_database) {
        k_log.debug("Waiting for cursor");
        await cursor_promise;
        const cursor = request.result;
        k_log.debug("Got cursor", cursor);
        if (request.result == undefined) {
          return {done: true};
        }
        const external_key = this.#key_as_external_format(cursor.value[this.#description.key]);
        let entry = {};
        if (external_key in this.#session_store) {
          Object.assign(entry, this.#session_store[external_key]);
        }
        Object.assign(entry, cursor.value);
        entry[this.#description.key] = external_key;

        result = {value: deep_freeze(entry), done: false};
        cursor.continue();
        cursor_promise = until_success(request);
      } else {
        if (external_keys.length == 0) {
          return {done: true};
        }
        const external_key = external_keys.shift();
        let entry = {...this.#session_store[external_key]};
        entry[this.#description.key] = external_key;
        result = {value: entry, done: false};
      }

      return result;
    };
    const return_fn = () => {
      // Called if we break/return from the loop early
      if (this.#use_database) {
        transaction.commit();
      }
      return {done: true};
    };

    return {
      [Symbol.asyncIterator]() {
        return {
          next: next_fn,
          return: return_fn,
        };
      },
    };
  }

  async get_selection_key(public_context = false) {
    if (!("selection" in this.#description)) {
      k_log.error("Attempted to get_selection_key but description has no selection");
      throw new Error("Attempted to get_selection_key but description has no selection");
    }
    k_log.debug("Store:", this.#store_name, "Getting selection key");

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    const [transaction, complete_promise] =
      this.#maybe_transaction({store: false, selection_store: true});
    let storage_key = await this.#get_selected_key_with_transaction(transaction);
    await complete_promise;

    if (storage_key == null) {
      return null;
    }
    return this.#key_as_external_format(storage_key);
  }

  async get_selection(public_context = false) {
    if (!("selection" in this.#description)) {
      k_log.error("Attempted to get_selection but description has no selection");
      throw new Error("Attempted to get_selection but description has no selection");
    }
    k_log.debug("Store:", this.#store_name, "Getting selection");

    if (public_context && !this.#store_public_access.has(e_store_access.existing_entries)) {
      k_log.error("No access to existing entries from a public context");
      throw new Error("No access to existing entries from a public context");
    }

    const [transaction, complete_promise] = this.#maybe_transaction({selection_store: true});

    let storage_key;
    let selection_db_entry;
    if (this.#use_selection_database()) {
      const object_store = transaction.objectStore(this.#description.selection.persist_to_store);
      const request = object_store.getAll();
      k_log.debug("Waiting for all selection values to be retrieved");
      await until_success(request);
      k_log.debug("All selection values retrieved");
      const selection_property_list = request.result;

      // Transform property list into an object
      selection_db_entry = {};
      for (const selection_property_entry of selection_property_list) {
        selection_db_entry[selection_property_entry[k_store_entry_selection_key_prop]] =
          selection_property_entry[k_store_entry_selection_value_prop];
      }

      if (!(this.#description.key in selection_db_entry)) {
        k_log.debug("No entry selected. Waiting for transaction to complete");
        await complete_promise;
        k_log.debug("Transaction complete");
        return null;
      }
      storage_key = selection_db_entry[this.#description.key];
    } else {
      if (!(this.#description.key in this.#session_selection_store)) {
        return null;
      }
      storage_key = this.#session_selection_store[this.#description.key];
    }
    const external_key = this.#key_as_external_format(storage_key);

    const general_entry = await this.#get_with_transaction(storage_key, external_key, transaction);

    if (this.#use_database) {
      k_log.debug("Got selection data. Waiting for transaction to complete");
      await complete_promise;
      k_log.debug("Transaction complete");
    }

    let entry = {};
    Object.assign(entry, general_entry);
    Object.assign(entry, this.#session_selection_store);
    if (selection_db_entry) {
      Object.assign(entry, selection_db_entry);
    }
    entry[this.#description.key] = external_key;
    this.#maybe_convert_to_public_entry(entry, public_context);
    return deep_freeze(entry);
  }

  async set_selection(partial_entry, public_context = false) {
    if (!("selection" in this.#description)) {
      k_log.error("Attempted to set_selection but description has no selection");
      throw new Error("Attempted to set_selection but description has no selection");
    }
    k_log.info("Store:", this.#store_name, "Setting selection");

    if (public_context && !this.#store_public_access.has(e_store_access.set_selection)) {
      k_log.error("No access to change selection from a public context");
      throw new Error("No access to change selection from a public context");
    }

    this.#check_writable(partial_entry, public_context);

    const storage_key = this.#key_as_storage_format(partial_entry[this.#description.key]);
    const [transaction, complete_promise] =
      this.#maybe_transaction({selection_store: true, write: true});

    this.#clear_selected_with_transaction(transaction);
    if (this.#use_selection_database()) {
      const object_store = transaction.objectStore(this.#description.selection.persist_to_store);
      const selection_object = {
        [k_store_entry_selection_key_prop]: this.#description.key,
        [k_store_entry_selection_value_prop]: storage_key,
      };
      object_store.put(selection_object);
    } else {
      this.#session_selection_store[this.#description.key] = storage_key;
    }

    const [entry, update_complete_promise] = await this.#update_with_transaction(
      partial_entry, storage_key, storage_key, transaction, complete_promise
    );

    if (this.#use_database) {
      k_log.debug("Waiting for update transaction to complete");
      await complete_promise;
      k_log.debug("Update transaction complete");
    }

    k_log.debug("Waiting for update action to complete");
    await update_complete_promise;
    k_log.debug("Update action complete");

    const properties_changed = new Set(Object.keys(partial_entry));
    properties_changed.delete(this.#description.key);

    k_log.debug("Firing property change listeners");
    let listener_arg = {
      type: e_change_type.property_changed,
      selection_changed: true,
      selection_set: true,
      entry
    };
    this.#fire_listeners(
      events => events.selected_only ||
                (events.any_property && properties_changed.size > 0) ||
                events.properties.findIndex(p => properties_changed.has(p)) != -1,
      listener_arg
    );
    k_log.debug("Property change listeners fired");
    return deep_freeze(entry);
  }

  async clear_selection(external_key, public_context = false) {
    if (!("selection" in this.#description)) {
      k_log.error("Attempted to clear_selection but description has no selection");
      throw new Error("Attempted to clear_selection but description has no selection");
    }
    k_log.info("Store:", this.#store_name, "Clearing selection");

    if (public_context && !this.#store_public_access.has(e_store_access.clear_selection)) {
      k_log.error("No access to change selection from a public context");
      throw new Error("No access to change selection from a public context");
    }

    const [transaction, complete_promise] =
      this.#maybe_transaction({store: false, selection_store: true, write: true});
    this.#clear_selected_with_transaction(transaction);

    if (this.#use_database) {
      k_log.debug("Selection cleared. Waiting for transaction to finish");
      await complete_promise;
      k_log.debug("Transaction finished");
    }

    k_log.debug("Firing property change listeners");
    let listener_arg = {
      type: e_change_type.entry_removed,
      selection_changed: true,
      selection_set: false
    };
    this.#fire_listeners(events => events.selected_only, listener_arg);
    k_log.debug("Property change listeners fired");
  }

  add_change_listener(listener) {
    deep_freeze(listener)
    this.#listeners.push(listener);
  }

  remove_change_listener(listener) {
    const to_remove = this.#listeners.findIndex(l => l === listener);
    if (to_remove == -1) {
      return false;
    }
    this.#listeners.splice(to_remove, 1);
    return true;
  }
}

class PublicStoreObject {
  #store;

  constructor(store) {
    this.#store = store;
  }

  async add(entry) {
    return this.#store.add(entry, true);
  }

  add_change_listener(listener) {
    listener.public_context = true;
    return this.#store.add_change_listener(listener);
  }

  async clear() {
    return this.#store.clear(true);
  }

  async clear_selection() {
    return this.#store.clear_selection(true);
  }

  async delete(key) {
    return this.#store.delete(key, true);
  }

  async get(key) {
    return this.#store.get(key, true);
  }

  async get_all() {
    return this.#store.get_all(true);
  }

  async get_selection() {
    return this.#store.get_selection(true);
  }

  async get_selection_key() {
    return this.#store.get_selection_key(true);
  }

  iter(query, direction) {
    return this.#store.iter(query, direction, true);
  }

  remove_change_listener(listener) {
    return this.#store.remove_change_listener(listener);
  }

  async set_selection(partial_entry) {
    return this.#store.set_selection(partial_entry, true);
  }

  async update(partial_entry) {
    return this.#store.update(partial_entry, true);
  }
}

export function sync_el_text_with_selection_property(store, unset_message, ids_by_property) {
  const callback = event => {
    for (const property in ids_by_property) {
      const value = event.selection_set ? event.entry[property] : unset_message;
      for (const id of ids_by_property[property]) {
        document.getElementById(id).textContent = value;
      }
    }
  };
  const listener = new ChangeListener({
    selected_only: true,
    properties: Object.keys(ids_by_property),
    callback
  });
  store.add_change_listener(listener);
  store.get_selection().then(selection => {
    let event = {
      type: e_change_type.property_changed,
      selection_changed: true,
      selection_set: selection != null
    };
    if (selection != null) {
      event.entry = selection;
    }
    callback(event);
  });
}

// Kick off the initialization process immediately. Silence errors since they will be logged
// elsewhere.
init().catch(() => {});
