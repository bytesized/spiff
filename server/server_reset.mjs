import * as m_api from "./api.mjs";
import * as m_db from "./db.mjs";
import * as m_log from "./log.mjs";
import * as m_server_events from "./server_events.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server/server_reset");

const k_server_reset_db_current_version = 1;

const k_first_server_reset_id = 1;
let g_current_server_reset_id;

const k_early_listen_start_minutes = 10;
const k_reset_poll_interval_seconds = 30;
// These times will all be in milliseconds since the epoch.
let g_next_scheduled_reset_time;
let g_last_reset_time;
let g_next_poll_time;
// We actually don't support launching while the SpaceTraders server is resetting. So either this
// is true or we will throw an error during initialization.
let g_server_reset_in_progress = false;
let g_server_reset_poll_timer;

let g_start_listeners = [];
let g_complete_listeners = [];

// Enumerated components that can be passed to `get_component_is_up_to_date()` and
// `set_component_is_up_to_date()`.
export const e_component = Object.freeze({
  star_chart: "e_component::star_chart",
});

const k_component_int = Object.freeze({
  [e_component.star_chart]: 1,
});

export async function init(args) {
  const metadata_response = await m_api.get_metadata();
  if (!metadata_response.success) {
    throw new Error(`Failed to get server metadata: ${metadata_response.error_message}`);
  }
  const next_reset_string = metadata_response.payload.serverResets?.next;
  if (typeof next_reset_string != "string") {
    throw new Error(`Expected string next reset time. Got ${JSON.stringify(next_reset_string)}`);
  }
  g_next_scheduled_reset_time = new Date(next_reset_string).getTime();
  g_last_reset_time = metadata_response.payload.resetDate;
  if (typeof g_last_reset_time != "string") {
    throw new Error(`Expected string last reset time. Got ${JSON.stringify(next_reset_string)}`);
  }

  await m_db.enqueue(async db => {
    let server_reset_db_version = await m_db.get_meta_int(m_db.e_meta_int.server_reset_version,
                                                          {already_within_transaction: true});
    if (server_reset_db_version == null) {
      // 0 will signify that the table has never been created so that we can always compare version
      // numbers with numeric comparison operators.
      server_reset_db_version = 0;
    }

    if (server_reset_db_version > k_server_reset_db_current_version) {
      throw new Error(
        `Software Downgrade Error: server_reset table is version ${server_reset_db_version}, ` +
        `but the software only supports up to version ${k_server_reset_db_current_version}`
      );
    } else if (server_reset_db_version < k_server_reset_db_current_version) {
      if (server_reset_db_version < 1) {
        await db.run(`
          CREATE TABLE server_reset(
            id INTEGER PRIMARY KEY ASC,
            last_reset TEXT NOT NULL,
            next_reset TEXT
          );
        `);
        await db.run(`
          CREATE TABLE server_reset_by_component(
            component_id INTEGER PRIMARY KEY ASC,
            server_reset_id INTEGER NOT NULL,
            FOREIGN KEY (server_reset_id) REFERENCES server_reset(id)
          );
        `);
      }

      await m_db.set_meta_int(m_db.e_meta_int.server_reset_version,
                              k_server_reset_db_current_version,
                              {already_within_transaction: true});
    }

    let result = await db.get("SELECT MAX(id) AS current FROM server_reset;");
    if (result.current == null) {
      result = await db.run(
        `INSERT INTO server_reset(id,  last_reset,  next_reset)
                          VALUES ($id, $last_reset, $next_reset);`,
        {
          $id: k_first_server_reset_id,
          $last_reset: g_last_reset_time,
          $next_reset: next_reset_string,
        }
      );
      g_current_server_reset_id = result.lastID;
    } else {
      g_current_server_reset_id = result.current;
      result = await db.get("SELECT last_reset FROM server_reset WHERE id = $id;", {
        $id: g_current_server_reset_id,
      });
      if (result.last_reset != g_last_reset_time) {
        result = await db.run(
          `INSERT INTO server_reset(id,  last_reset,  next_reset)
                            VALUES ($id, $last_reset, $next_reset);`,
          {
            $id: g_current_server_reset_id + 1,
            $last_reset: g_last_reset_time,
            $next_reset: next_reset_string,
          }
        );
        k_log.info("Server reset since last run", g_current_server_reset_id, "->", result.lastID);
        g_current_server_reset_id = result.lastID;
      }
    }
  }, {with_transaction: true});

  start_reset_polling_timer();
}

export async function shutdown() {
  if (g_server_reset_poll_timer) {
    clearTimeout(g_server_reset_poll_timer);
  }
}

export function current_server_reset_id() {
  return g_current_server_reset_id;
}

/**
 * When a server reset starts, listeners passed to this function will be fired.
 * These listeners are not guaranteed to fire, but should if the reset happens close to the
 * advertised time. And takes longer than the polling interval.
 * Listeners will be passed no arguments.
 */
export function add_begin_reset_listener(fn) {
  g_start_listeners.push(fn);
}

/**
 * When a server reset completes, listeners passed to this function will be fired.
 * These listeners are guaranteed to be fired any time the server reset id changes, except on
 * server launch.
 * Listeners will be passed a single argument that will be an object with the following properties:
 *  previous_server_reset_id
 *    The server reset id from before the server reset.
 *  server_reset_id
 *    The new server reset id.
 */
export function add_reset_complete_listener(fn) {
  g_complete_listeners.push(fn);
}

function human_readable_duration(duration_ms) {
  let sign = "";
  if (duration_ms < 0) {
    sign = "-";
    duration_ms *= -1;
  }

  const milliseconds = duration_ms % 1000;

  const duration_seconds = (duration_ms - milliseconds) / 1000;
  const seconds = duration_seconds % 60;

  const duration_minutes = (duration_seconds - seconds) / 60;
  const minutes = duration_minutes % 60;

  const duration_hours = (duration_minutes - minutes) / 60;
  const hours = duration_hours % 24;

  const days = (duration_hours - hours) / 24;

  return (
    sign +
    days.toString() + "d" +
    hours.toString() + "h" +
    minutes.toString() + "m" +
    seconds.toString() + "." + milliseconds.toString().padStart(3, "0") + "s"
  );
}

/**
 * Expects `g_next_scheduled_reset_time` to be set properly. Sets `g_next_poll_time` and starts a
 * timer that calls `on_reset_timer_expired`.
 */
function start_reset_polling_timer() {
  const now = new Date().getTime();
  g_next_poll_time = g_next_scheduled_reset_time - (k_early_listen_start_minutes * 60 * 1000);
  const delay = Math.max(0, g_next_poll_time - now);
  k_log.debug("Time until server reset polling starts:", () => human_readable_duration(delay));
  g_server_reset_poll_timer = setTimeout(on_reset_timer_expired, delay);
}

async function on_reset_timer_expired({already_within_transaction = false} = {}) {
  g_server_reset_poll_timer = null;

  const now = new Date().getTime();
  if (now < g_next_poll_time) {
    k_log.debug("Timer fired early by", () => human_readable_duration(g_next_poll_time - now));
    start_reset_polling_timer();
    return;
  }
  g_next_poll_time += k_reset_poll_interval_seconds * 1000;

  const metadata_response = await m_api.get_metadata();
  if (!metadata_response.success) {
    // This probably means that the server reset is in-progress
    if (!g_server_reset_in_progress) {
      g_server_reset_in_progress = true;

      for (const listener of g_start_listeners) {
        try {
          await listener();
        } catch (ex) {
          k_log.error(ex);
        }
      }
    }
  } else {
    const last_reset = metadata_response.payload.resetDate;
    if (typeof last_reset != "string") {
      throw new Error(`Expected string last reset time. Got ${JSON.stringify(next_reset_string)}`);
    }
    const next_reset_string = metadata_response.payload.serverResets?.next;
    if (typeof next_reset_string != "string") {
      throw new Error(`Expected string next reset time. Got ${JSON.stringify(next_reset_string)}`);
    }
    g_next_scheduled_reset_time = new Date(next_reset_string).getTime();
    if (last_reset == g_last_reset_time) {
      const new_polling_start =
        g_next_scheduled_reset_time - (k_early_listen_start_minutes * 60 * 1000);
      if (new_polling_start > g_next_poll_time) {
        k_log.info("Reset time postponed until", () => new Date(new_polling_start));
        g_next_poll_time = new_polling_start;
      }
    } else {
      g_last_reset_time = last_reset;
      const old_server_reset_id = g_current_server_reset_id;
      g_current_server_reset_id += 1;
      k_log.info("Server reset detected", old_server_reset_id, "->", g_current_server_reset_id);

      await m_db.enqueue(async db => {
        await db.run(
          `INSERT INTO server_reset(id,  last_reset,  next_reset)
                            VALUES ($id, $last_reset, $next_reset);`,
          {
            $id: g_current_server_reset_id,
            $last_reset: g_last_reset_time,
            $next_reset: next_reset_string,
          }
        );
      }, {already_within_transaction});

      start_reset_polling_timer();

      const arg = Object.freeze({
        previous_server_reset_id: old_server_reset_id,
        server_reset_id: g_current_server_reset_id,
      });
      for (const listener of g_complete_listeners) {
        try {
          await listener(arg);
        } catch (ex) {
          k_log.error(ex);
        }
      }

      m_server_events.send(m_server_events.e_event_type.server_reset, arg);
      return;
    }
  }

  const delay = Math.max(0, g_next_poll_time - now);
  k_log.debug("Waiting for server reset. Next poll in", () => human_readable_duration(delay));
  g_server_reset_poll_timer = setTimeout(on_reset_timer_expired, delay);
}

export async function get_component_is_up_to_date(component,
                                                  {already_within_transaction = false} = {}) {
  return m_db.enqueue(async db => {
    const result = await db.get(
      "SELECT server_reset_id FROM server_reset_by_component WHERE component_id = $component_id",
      {$component_id: k_component_int[component]}
    );
    return result != undefined && result.server_reset_id == g_current_server_reset_id;
  }, {already_within_transaction});
}

export async function set_component_is_up_to_date(component,
                                                  {already_within_transaction = false} = {}) {
  await m_db.enqueue(async db => {
    await db.run(
      `INSERT OR REPLACE INTO server_reset_by_component (component_id,  server_reset_id)
                                                 VALUES ($component_id, $server_reset_id)`,
      {$component_id: k_component_int[component], $server_reset_id: g_current_server_reset_id}
    );
  }, {already_within_transaction});
}
