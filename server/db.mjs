import {promises as m_fs} from "fs";
import * as m_log from "./log.mjs";
import * as m_path from "path";
import * as m_sqlite from "sqlite";
import m_sqlite3 from "sqlite3";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server/db");

// These are ignored if the `--dbpath` argument is used.
const db_dirname = "spiff";
const db_filename = "data.sqlite";

let g_db;
let g_db_queue;

const k_meta_int_module_current_version = 1;

export const e_meta_int = {
  meta_int_module_version: "e_meta_int::meta_int_module_version",
  server_reset_version: "e_meta_int::server_reset_version",
  agent_module_version: "e_meta_int::agent_module_version",
  agent_server_reset_behavior: "e_meta_int::agent_server_reset_behavior",
  star_chart_module_version: "e_meta_int::star_chart_module_version",
};

// These must be unique integers
const k_meta_int_key = {
  [e_meta_int.meta_int_module_version]: 1,
  [e_meta_int.server_reset_version]: 2,
  [e_meta_int.agent_module_version]: 3,
  [e_meta_int.agent_server_reset_behavior]: 4,
  [e_meta_int.star_chart_module_version]: 5,
};

export async function init(args) {
  let db_path;
  if ("dbpath" in args) {
    db_path = args.db_path;
  } else if ("_B_UTIL_DATA_DIR" in process.env) {
    db_path = m_path.join(process.env._B_UTIL_DATA_DIR, db_dirname, db_filename);
  } else {
    throw new Error("Error! Unable to determine database path (use --dbpath)");
  }
  db_path = m_path.resolve(db_path);
  m_fs.mkdir(m_path.dirname(db_path), {recursive: true});
  g_db = await m_sqlite.open({filename: db_path, driver: m_sqlite3.Database});
  await g_db.run("PRAGMA foreign_keys = ON;");

  await g_db.run("BEGIN TRANSACTION;");

  try {
    await g_db.run(`
      CREATE TABLE IF NOT EXISTS meta_int(
        key INTEGER PRIMARY KEY ASC,
        value INTEGER NOT NULL
      );
    `);
    const version_entry = await g_db.get("SELECT value FROM meta_int WHERE key = $key;", {
      $key: k_meta_int_key[e_meta_int.meta_int_module_version],
    });
    if (version_entry == undefined) {
      await g_db.run("INSERT INTO meta_int (key, value) VALUES ($key, $value);", {
        $key: k_meta_int_key[e_meta_int.meta_int_module_version],
        $value: k_meta_int_module_current_version,
      });
    } else if (version_entry.value > k_meta_int_module_current_version) {
      throw new Error(
        `Software Downgrade Error: meta_int table is version ${version_entry.value}, but the ` +
        `software only supports up to version ${k_meta_int_module_current_version}`
      );
    } else if (version_entry.value < k_meta_int_module_current_version) {
      throw new Error(
        `Not Implemented Error: meta_int table needs to be upgraded, but upgrading is not ` +
        `currently supported.`
      );
    }

    await g_db.run("COMMIT TRANSACTION;");
  } catch (ex) {
    try {k_log.error("Init transaction failed. Rolling back.", ex);} catch (ex) {}
    try {
      await g_db.run("ROLLBACK TRANSACTION;");
    } catch (ex2) {
      k_log.error("Failed to roll back init transaction", ex2);
    }
    throw ex;
  }

  g_db_queue = Promise.resolve();
}

export async function shutdown() {
  k_log.warn("Waiting for pending db transactions to complete");
  const queue = g_db_queue;
  g_db_queue = null;
  try {
    await queue;
  } catch (ex) {
    k_log.warn("Caught exception when draining the db queue", ex);
  }
  k_log.info("Pending db transactions completed. Closing connection");
  await g_db.close();
  k_log.info("Connection closed.");
}

/**
 * We are going to serialize access to the database. We really don't want two asynchronous
 * functions interleaving database access if either of them is using a transaction. We can't start
 * two transactions at once, nor do we want some one-off database call to become part of some
 * transaction that happens to have been going on at the same time.
 */
export async function enqueue(fn, {
                                already_within_transaction = false,
                                with_transaction = false
                              } = {}) {
  if (already_within_transaction) {
    return fn(g_db);
  }

  const db_access_fn = async () => {
    if (!with_transaction) {
      k_log.debug("Running transaction-less");
      return fn(g_db);
    }

    k_log.debug("Beginning transaction");
    await g_db.run("BEGIN TRANSACTION;");
    let result = null;
    try {
      result = await fn(g_db);

      await g_db.run("COMMIT TRANSACTION;");
      k_log.debug("Transaction complete");
    } catch (ex) {
      try {
        k_log.warn("Transaction failed. Rolling back.", ex, "\n", () => (new Error()).stack);
      } catch (ex) {}
      try {
        await g_db.run("ROLLBACK TRANSACTION;");
      } catch (ex2) {
        k_log.error("Failed to roll back transaction", ex2);
      }
      throw ex;
    }
    return result;
  };

  g_db_queue = g_db_queue.then(() => {}, () =>{}).then(db_access_fn);
  return g_db_queue;
}

/**
 * @param key
 *        A value of `e_meta_int`.
 * @returns
 *        The value corresponding with the passed key, or `null`, if no value is set.
 */
export async function get_meta_int(key, {already_within_transaction = false} = {}) {
  if (!(key in k_meta_int_key)) {
    throw new Error(`Invalid meta_int key: ${key}`);
  }

  return enqueue(async db => {
    const row = await g_db.get("SELECT value FROM meta_int WHERE key = $key;", {
      $key: k_meta_int_key[key],
    });
    if (row == undefined) {
      return null;
    }
    return row.value;
  }, {already_within_transaction});
}

/**
 * @param key
 *        A value of `e_meta_int`.
 * @param value
 *        The value to associate with the passed key.
 */
export async function set_meta_int(key, value, {already_within_transaction = false} = {}) {
  if (!(key in k_meta_int_key)) {
    throw new Error(`Invalid meta_int key: ${key}`);
  }

  if (!Number.isInteger(value)) {
    throw new Error(
      `meta_int can only accept integer values but was given ${JSON.stringify(value)}`
    );
  }

  return enqueue(async db => {
    await g_db.run(
      "INSERT OR REPLACE INTO meta_int (key, value) VALUES ($key, $value);",
      {
        $key: k_meta_int_key[key],
        $value: value,
      }
    );
  }, {already_within_transaction});
}
