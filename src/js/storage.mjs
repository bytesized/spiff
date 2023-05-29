import * as m_popup from "./popup.mjs";

export const e_data_type = {
  string: "e_data_type::string",
  integer: "e_data_type::integer",
  json: "e_data_type::json",
};

// It seems possible that this could at some point be hosted on the same host as another web app.
// Just in case, let's set a prefix for this app that should prevent our localStorage keys from
// conflicting with keys from another app
const k_key_prefix = "bytesized|spiff|";
const k_public_scope = "public";
const k_private_scope = "private";
const k_module_version_key = "module_version";
const k_storage_version_key = "storage_version";
const k_key_list_key = "keys";

const k_storage_current_version = 1;

const k_localstorage_available = storage_available("localStorage");

let g_existing_modules = new Set();

/**
 * @param module_name
 *        A unique name for the storage module to construct.
 * @param module_version
 *        An integer version of the data schema being used by this module.
 * @param fields
 *        An object with field name properties and field description object values. The field names
 *        must not contain the `|` character. The field description objects can have these
 *        properties:
 *          type
 *            Required. The type of data that will be stored in this field. This must be a value
 *            from `e_data_type`.
 *          keyed
 *            Optional. If specified, should be a boolean indicating whether or not this is a keyed
 *            field. The default is `false`. If `true`, this field will function less like an
 *            individual value and more like a javascript object.
 *          persist
 *            Optional. If specified, should be a boolean indicating whether or not this field's
 *            data should be persisted in localStorage. The default is `false`.
 * @returns
 *        An object allowing storage, retrieval, and change callbacks for the requested data
 *        fields. Example usage:
 *          let s = create(
 *            "module",
 *            1,
 *            {
 *              unkeyed_string: {type: e_data_type.string},
 *              keyed_string: {keyed: true, type: e_data_type.string},
 *            }
 *          );
 *          console.log(s.unkeyed_string.get()); // Will be `null` when unset.
 *          s.unkeyed_string.set("value");
 *          console.log(s.unkeyed_string.get());
 *          // The callback will be immediately fired, displaying "value".
 *          s.unkeyed_string.add_change_listener(
 *            new_value => console.log(`value: ${new_value}`),
 *            {run_immediately: true}
 *          );
 *          // Fires the callback again, displaying "value2".
 *          s.unkeyed_string.set("value2");
 *          // Fires the callback again, displaying "null".
 *          s.unkeyed_string.unset();
 *          s.keyed_string.set("key", "value");
 *          console.log(s.keyed_string.get("key"));
 *          // Prints a message when `s.keyed_string.set("key", ...)` is called.
 *          s.keyed_string.add_change_listener("key", console.log);
 */
export function create(module_name, module_version, fields) {
  if (g_existing_modules.has(module_name)) {
    throw new Error(`Module "${module_name}" already initialized.`);
  }
  g_existing_modules.add(module_name);

  if (!k_localstorage_available) {
    m_popup.show({
      title: "Storage Error",
      message:
        "Your browser does not attempt to support the localStorage feature. This app will not " +
        "function properly.",
      buttons: [],
    });
    throw new Error("Local Storage not available.");
  }

  let last_module_version = raw_read(module_name, k_private_scope, k_module_version_key);
  if (last_module_version != null && parseInt(last_module_version, 10) > module_version) {
    m_popup.show({
      title: "Downgrade Detected",
      message:
        `The data stored for module "${module_name}" is module version ${last_module_version}, ` +
        `but this code is running module version ${module_version}. Messing with this data ` +
        `could screw things up. Consequently, this app will not operate properly until upgraded.`,
      buttons: [],
    });
    throw new Error(`Downgrade Error: Storage for module: "${module_name}".`);
  }
  raw_write(module_name, k_private_scope, k_module_version_key, module_version.toString());

  let last_store_version = raw_read(module_name, k_private_scope, k_storage_version_key);
  if (last_store_version != null && parseInt(last_store_version, 10) > k_storage_current_version) {
    m_popup.show({
      title: "Downgrade Detected",
      message:
        `The data stored for module "${module_name}" is storage version ${last_store_version}, ` +
        `but this code is running storage version ${k_storage_version_key}. Messing with this ` +
        `data could screw things up. Consequently, this app will not operate properly until ` +
        `upgraded.`,
      buttons: [],
    });
    throw new Error(`Downgrade Error: Storage for module: "${module_name}".`);
  }
  raw_write(module_name, k_private_scope, k_storage_version_key,
            k_storage_current_version.toString());

  if (module_name.includes("|")) {
    throw new Error(`Module name "${module_name}" should not include a pipe character ("|").`);
  }

  for (const field_name in fields) {
    if (field_name.includes("|")) {
      throw new Error(`Field name "${field_name}" should not include a pipe character ("|").`);
    }
  }

  return new storage_object(module_name, fields);
}

function raw_write(module_name, scope, key, value) {
  localStorage.setItem(k_key_prefix + module_name + "|" + scope + "|" + key, value);
}

function raw_remove(module_name, scope, key) {
  localStorage.removeItem(k_key_prefix + module_name + "|" + scope + "|" + key);
}

function raw_read(module_name, scope, key) {
  return localStorage.getItem(k_key_prefix + module_name + "|" + scope + "|" + key);
}

function storage_available(type) {
  let storage;
  try {
    storage = window[type];
    const x = k_key_prefix + "__storage_test__";
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return (
      e instanceof DOMException &&
      // everything except Firefox
      (e.code === 22 ||
        // Firefox
        e.code === 1014 ||
        // test name field too, because code might not be present
        // everything except Firefox
        e.name === "QuotaExceededError" ||
        // Firefox
        e.name === "NS_ERROR_DOM_QUOTA_REACHED") &&
      // acknowledge QuotaExceededError only if there's something already stored
      storage &&
      storage.length !== 0
    );
  }
}

class storage_object {
  #module_name;
  #data = {};
  #on_change_callbacks = {};

  constructor(module_name, fields) {
    this.#module_name = module_name;

    for (const field_name in fields) {
      const field = fields[field_name];

      let ls_read = (scope, key) => {};
      let ls_write = (scope, key, value) => {};
      let ls_remove = (scope, key) => {};
      if (field.persist) {
        ls_remove = this.#remove_localStorage.bind(this);
        switch(field.type) {
        case e_data_type.string:
          ls_read = this.#read_localStorage_string.bind(this);
          ls_write = this.#write_localStorage_string.bind(this);
          break;
        case e_data_type.integer:
          ls_read = this.#read_localStorage_int.bind(this);
          ls_write = this.#write_localStorage_int.bind(this);
          break;
        case e_data_type.json:
          ls_read = this.#read_localStorage_json.bind(this);
          ls_write = this.#write_localStorage_json.bind(this);
          break;
        default:
          throw new Error(`Error: Unknown data type encountered: ${field.type}`);
        }
      }

      this[field_name] = {};
      if (field.keyed) {
        this.#data[field_name] = {};
        this.#on_change_callbacks[field_name] = {};

        if (field.persist) {
          let keys = this.#read_localStorage_json(k_private_scope, k_key_list_key);
          if (keys != null) {
            for (const key of keys) {
              let value = ls_read(k_public_scope, field_name + "|" + key);
              if (value != null) {
                this.#data[field_name][key] = value;
              }
            }
          }
        }

        let update_key_list = () => {};
        if (field.persist) {
          update_key_list = () => {
            this.#write_localStorage_json(
              k_private_scope,
              k_key_list_key,
              Object.keys(this.#data[field_name])
            );
          };
        }

        let run_callbacks = (key, value) => {
          if (key in this.#on_change_callbacks[field_name]) {
            for (const callback of this.#on_change_callbacks[field_name][key]) {
              callback(value);
            }
          }
        };

        this[field_name].set = (key, value) => {
          if (field.type != e_data_type.json && this.#data[field_name][key] == value) {
            return;
          }
          let key_list_dirty = !(key in this.#data[field_name]);
          this.#data[field_name][key] = value;
          if (key_list_dirty) {
            update_key_list();
          }
          ls_write(k_public_scope, field_name + "|" + key, value);
          run_callbacks(key, value);
        };
        this[field_name].get = key => {
          if (key in this.#data[field_name]) {
            return this.#data[field_name][key];
          }
          return null;
        };
        this[field_name].is_set = key => key in this.#data[field_name];
        this[field_name].unset = key => {
          if (!(key in this.#data[field_name])) {
            return;
          }
          delete this.#data[field_name][key];
          ls_remove(k_public_scope, field_name + "|" + key);
          update_key_list();
          run_callbacks(key, null);
        };
        this[field_name].add_change_listener = (key, callback, {run_immediately} = {}) => {
          if (!(key in this.#on_change_callbacks[field_name])) {
            this.#on_change_callbacks[field_name][key] = [];
          }
          this.#on_change_callbacks[field_name][key].push(callback);
          if (run_immediately) {
            callback(this[field_name].get(key));
          }
        };
        this[field_name].remove_change_listener = (key, callback) => {
          if (!(key in this.#on_change_callbacks[field_name])) {
            return;
          }
          for (let i = 0; i < this.#on_change_callbacks[field_name][key].length; i++) {
            if (this.#on_change_callbacks[field_name][key][i] == callback) {
              this.#on_change_callbacks[field_name][key].splice(i, 1);
              return;
            }
          }
        };
      } else {
        if (field.persist) {
          let persisted_value = ls_read(k_public_scope, field_name);
          if (persisted_value != null) {
            this.#data[field_name] = persisted_value;
          }
        }

        this.#on_change_callbacks[field_name] = [];

        let run_callbacks = value => {
          for (const callback of this.#on_change_callbacks[field_name]) {
            callback(value);
          }
        };

        this[field_name].set = value => {
          if (field.type != e_data_type.json && this.#data[field_name] == value) {
            return;
          }
          this.#data[field_name] = value;
          ls_write(k_public_scope, field_name, value);
          run_callbacks(value);
        };
        this[field_name].get = () => {
          if (field_name in this.#data) {
            return this.#data[field_name];
          }
          return null;
        };
        this[field_name].is_set = () => field_name in this.#data;
        this[field_name].unset = () => {
          if (!(field_name in this.#data)) {
            return;
          }
          delete this.#data[field_name];
          ls_remove(k_public_scope, field_name);
          run_callbacks(null);
        };
        this[field_name].add_change_listener = (callback, {run_immediately} = {}) => {
          this.#on_change_callbacks[field_name].push(callback);
          if (run_immediately) {
            callback(this[field_name].get())
          }
        };
        this[field_name].remove_change_listener = callback => {
          for (let i = 0; i < this.#on_change_callbacks[field_name].length; i++) {
            if (this.#on_change_callbacks[field_name][i] == callback) {
              this.#on_change_callbacks[field_name].splice(i, 1);
              return;
            }
          }
        };
      }
    }
  }

  #write_localStorage_string(scope, key, value) {
    raw_write(this.#module_name, scope, key, value);
  }

  #write_localStorage_int(scope, key, value) {
    this.#write_localStorage_string(scope, key, value.toString());
  }

  #write_localStorage_json(scope, key, value) {
    this.#write_localStorage_string(scope, key, JSON.stringify(value));
  }

  #remove_localStorage(scope, key) {
    raw_remove(this.#module_name, scope, key);
  }

  #read_localStorage_string(scope, key) {
    return raw_read(this.#module_name, scope, key);
  }

  #read_localStorage_int(scope, key) {
    let value = this.#read_localStorage_string(scope, key);
    if (value == null) {
      return null;
    }
    let int_value = parseInt(value, 10);
    if (isNaN(int_value)) {
      throw new Error(`Storage expected to retrieve an integer. Instead got "${value}"`);
    }
    return int_value;
  }

  #read_localStorage_json(scope, key) {
    let value = this.#read_localStorage_string(scope, key);
    if (value == null) {
      return null;
    }
    return JSON.parse(value);
  }
}

export class view {
  #on_change_callbacks = {};
  #old_key_value = {};

  /**
   * @param storage
   *        An instance of `storage_object`.
   * @param fields
   *        An object with property names specifying field names in `storage` that should be
   *        available in the created view. The values should each be an object containing these
   *        properties:
   *          from
   *            Optional string field name. If specified, this field name will be used when
   *            accessing `storage` rather than using the same name as the view field name.
   *          readonly
   *            Optional, defaults to `false`. If `true`, methods that modify the field won't be
   *            available.
   *          key_field
   *            Optional string field name. The field name specified will be used to look up the
   *            key that should be returned. This effectively turns a keyed field into an un-keyed
   *            field.
   *            Fields like this do not need to be readonly, but attempting to modify them if the
   *            key field is not set will raise an exception.
   */
  constructor(storage, fields) {
    for (const field_name in fields) {
      const field = fields[field_name];

      let orig_field = field_name;
      if ("from" in field) {
        orig_field = field.from;
      }

      this[field_name] = {};
      if ("key_field" in field) {
        this[field_name].get = () => {
          let key = storage[field.key_field].get();
          return key == null ? null : storage[orig_field].get(key);
        };
        this[field_name].is_set = () => {
          let key = storage[field.key_field].get();
          return key == null ? false : storage[orig_field].is_set(key);
        };
        this[field_name].add_change_listener = (callback, {run_immediately} = {}) => {
          this.#on_change_callbacks[field_name].push(callback);
          if (run_immediately) {
            callback(this[field_name].get());
          }
        };
        this[field_name].remove_change_listener = callback => {
          for (let i = 0; i < this.#on_change_callbacks[field_name].length; i++) {
            if (this.#on_change_callbacks[field_name][i] == callback) {
              this.#on_change_callbacks[field_name].splice(i, 1);
              return;
            }
          }
        };

        this.#on_change_callbacks[field_name] = [];
        this.#old_key_value[field_name] = storage[field.key_field].get();
        let run_callbacks = new_value => {
          for (const callback of this.#on_change_callbacks[field_name]) {
            callback(new_value);
          }
        };
        storage[field.key_field].add_change_listener(new_value => {
          if (this.#old_key_value[field_name] != null) {
            storage[orig_field].remove_change_listener(this.#old_key_value[field_name],
                                                       run_callbacks);
          }
          this.#old_key_value[field_name] = new_value;
          if (new_value != null) {
            storage[orig_field].add_change_listener(new_value, run_callbacks);
          }

          run_callbacks(this[field_name].get());
        });
        storage[orig_field].add_change_listener(this.#old_key_value[field_name], run_callbacks);

        if (!field.readonly) {
          this[field_name].set = value => {
            let key = storage[field.key_field].get();
            if (key == null) {
              throw new Error(
                `Attempted to set ${field_name}, but key field ${field.key_field} is not set`
              );
            }
            storage[orig_field].set(key, value);
          };
          this[field_name].unset = () => {
            let key = storage[field.key_field].get();
            if (key == null) {
              throw new Error(
                `Attempted to unset ${field_name}, but key field ${field.key_field} is not set`
              );
            }
            storage[orig_field].unset(key);
          };
        }
      } else {
        this[field_name].get = storage[orig_field].get.bind(storage);
        this[field_name].is_set = storage[orig_field].is_set.bind(storage);
        this[field_name].add_change_listener =
          storage[orig_field].add_change_listener.bind(storage);
        this[field_name].remove_change_listener =
          storage[orig_field].remove_change_listener.bind(storage);
        if (!field.readonly) {
          this[field_name].set = storage[orig_field].set.bind(storage);
          this[field_name].unset = storage[orig_field].unset.bind(storage);
        }
      }
    }
  }
}
