import * as m_popup from "./popup.mjs";

// It seems possible that this could at some point be hosted on the same host as another web app.
// Just in case, let's set a prefix for this app that should prevent our localStorage keys from
// conflicting with keys from another app
const k_localstorage_key_prefix = "bytesized_spiff_";

const k_version_key = "version";

let existing_modules = new Set();

export function create(module_name, module_version) {
  if (existing_modules.has(module_name)) {
    throw new Error(`Module "${module_name}" already initialized.`);
  }
  existing_modules.add(module_name);

  if (!storageAvailable("localStorage")) {
    m_popup.show({
      title: "Storage Error",
      message:
        "Your browser does not attempt to support the localStorage feature. This app will not " +
        "function properly.",
      buttons: [],
    });
    throw new Error("Local Storage not available.");
  }

  let last_version = raw_read(module_name, k_version_key);
  if (last_version != null && parseInt(last_version, 10) > module_version) {
    m_popup.show({
      title: "Downgrade Detected",
      message:
        `The data stored for module "${module_name}" is version ${last_version}, but this code ` +
        `is running version ${module_version}. Messing with this data could screw things up. ` +
        `Consequently, this app will not operate properly until upgraded.`,
      buttons: [],
    });
    throw new Error(`Downgrade Error: Storage for module: "${module_name}".`);
  }
  raw_write(module_name, k_version_key, module_version);

  if (module_name.includes("|")) {
    throw new Error(`Module name "${module_name}" should not include a pipe character ("|").`);
  }

  return new storer(module_name);
}

function raw_write(module_name, key, value) {
  localStorage.setItem(k_localstorage_key_prefix + module_name + "|" + key, value);
}

function raw_remove(module_name, key) {
  localStorage.removeItem(k_localstorage_key_prefix + module_name + "|" + key);
}

function raw_read(module_name, key) {
  return localStorage.getItem(k_localstorage_key_prefix + module_name + "|" + key);
}

function storageAvailable(type) {
  let storage;
  try {
    storage = window[type];
    const x = "__storage_test__";
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

class storer {
  constructor(module_name) {
    this.module_name = module_name;
  }

  write(key, value) {
    if (key == k_version_key) {
      throw new Error("Invalid for a module to attempt to set its own stored version data.");
    }
    raw_write(this.module_name, key, value);
  }

  write_int(key, value) {
    this.write(key, value.toString());
  }

  write_json(key, value) {
    this.write(key, JSON.stringify(value));
  }

  remove(key) {
    if (key == k_version_key) {
      throw new Error("Invalid for a module to attempt to remove its own stored version data.");
    }
    raw_remove(this.module_name, key);
  }

  read(key) {
    return raw_read(this.module_name, key);
  }

  read_int(key) {
    let value = this.read(key);
    if (value == null) {
      return null;
    }
    let int_value = parseInt(value, 10);
    if (isNaN(int_value)) {
      throw new Error(`Storage expected to retrieve an integer. Instead got "${value}"`);
    }
    return int_value;
  }

  read_json(key) {
    let value = this.read(key);
    if (value == null) {
      return null;
    }
    return JSON.parse(value);
  }

  has(key) {
    return this.read(key) != null;
  }

  get_version() {
    return this.read(k_version_key);
  }
}
