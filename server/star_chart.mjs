import * as m_agent from "./agent.mjs"
import * as m_api from "./api.mjs"
import * as m_db from "./db.mjs";
import * as m_log from "./log.mjs";
import * as m_server_events from "./server_events.mjs";
import * as m_server_reset from "./server_reset.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server/star_chart");

const k_star_chart_db_current_version = 1;

let g_chart_load_promise = null;
let g_chart_load_error_message = null;
let g_has_shutdown = false;
let g_metadata_loaded = false;
let g_load_cancellation_in_progress = false;
let g_system_count;
let g_total_pages_needed;
let g_pages_loaded;
let g_system_waypoints_loaded;

export async function init(args) {
  await m_db.enqueue(async db => {
    let star_chart_db_version = await m_db.get_meta_int(m_db.e_meta_int.star_chart_module_version,
                                                        {already_within_transaction: true});
    if (star_chart_db_version == null) {
      // 0 will signify that the star chart tables have never been created so that we can always
      // compare version numbers with numeric comparison operators.
      star_chart_db_version = 0;
    }

    if (star_chart_db_version > k_star_chart_db_current_version) {
      throw new Error(
        `Software Downgrade Error: star chart table is version ${star_chart_db_version}, but ` +
        `the software only supports up to version ${k_star_chart_db_current_version}`
      );
    } else if (star_chart_db_version < k_star_chart_db_current_version) {
      if (star_chart_db_version < 1) {
        await db.run(`
          CREATE TABLE sector(
            id INTEGER PRIMARY KEY ASC,
            symbol TEXT UNIQUE NOT NULL
          );
        `);
        await db.run(`
          CREATE TABLE system_type(
            id INTEGER PRIMARY KEY ASC,
            symbol TEXT UNIQUE NOT NULL
          );
        `);
        await db.run(`
          CREATE TABLE system(
            id INTEGER PRIMARY KEY ASC,
            symbol TEXT UNIQUE NOT NULL,
            sector_id INTEGER NOT NULL,
            type_id INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            FOREIGN KEY (sector_id) REFERENCES sector(id),
            FOREIGN KEY (type_id) REFERENCES system_type(id)
          );
        `);
        await db.run(`
          CREATE INDEX index_system_x ON system(x);
        `);
        await db.run(`
          CREATE INDEX index_system_y ON system(y);
        `);
        await db.run(`
          CREATE TABLE system_load(
            page_id INTEGER PRIMARY KEY ASC,
            loaded INTEGER NOT NULL DEFAULT 0
          );
        `);
        await db.run(`
          CREATE INDEX index_system_load_loaded ON system_load(loaded);
        `);
        await db.run(`
          CREATE TABLE waypoint_type(
            id INTEGER PRIMARY KEY ASC,
            symbol TEXT UNIQUE NOT NULL
          );
        `);
        await db.run(`
          CREATE TABLE waypoint(
            id INTEGER PRIMARY KEY ASC,
            system_id INTEGER NOT NULL,
            symbol TEXT UNIQUE NOT NULL,
            type_id INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            FOREIGN KEY (system_id) REFERENCES system(id),
            FOREIGN KEY (type_id) REFERENCES waypoint_type(id)
          );
        `);
        await db.run(`
          CREATE TABLE waypoint_orbit(
            orbited INTEGER NOT NULL,
            orbital INTEGER NOT NULL,
            FOREIGN KEY (orbited) REFERENCES waypoint(id),
            FOREIGN KEY (orbital) REFERENCES waypoint(id)
          );
        `);
        await db.run(`
          CREATE TABLE waypoint_load(
            system_id INTEGER NOT NULL,
            loaded INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (system_id) REFERENCES system(id)
          );
        `);
        await db.run(`
          CREATE INDEX index_waypoint_load_loaded ON waypoint_load(loaded);
        `);
        await db.run(`
          CREATE TABLE waypoint_trait_type(
            id INTEGER PRIMARY KEY ASC,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL
          );
        `);
        await db.run(`
          CREATE TABLE waypoint_trait(
            waypoint_id INTEGER NOT NULL,
            trait_id INTEGER NOT NULL,
            FOREIGN KEY (waypoint_id) REFERENCES waypoint(id),
            FOREIGN KEY (trait_id) REFERENCES waypoint_trait_type(id)
          );
        `);
      }

      await m_db.set_meta_int(m_db.e_meta_int.star_chart_module_version,
                              k_star_chart_db_current_version,
                              {already_within_transaction: true});
    }

    const up_to_date = await m_server_reset.get_component_is_up_to_date(
      m_server_reset.e_component.star_chart,
      {already_within_transaction: true}
    );
    if (!up_to_date) {
      await reset({already_within_transaction: true});
    }
    const selected_agent = await m_agent.get_selected_agent({already_within_transaction: true});
    if (selected_agent != null) {
      await start_chart_load(selected_agent.auth_token, selected_agent.server_reset_id);
    }
  }, {with_transaction: true});

  m_server_reset.add_reset_complete_listener(async server_reset => reset());

  m_agent.add_change_agent_selection_listener(async (agent, {already_within_transaction}) => {
    if (agent.id != null && !g_chart_load_promise) {
      await start_chart_load(agent.auth_token, agent.server_reset_id);
    }
  });
}

export async function shutdown() {
  g_has_shutdown = true;
  await cancel_chart_load();
}

async function cancel_chart_load() {
  if (!g_chart_load_promise) {
    k_log.debug("Cancel chart load is a no-op because we aren't loading a chart");
    return;
  }

  if (g_load_cancellation_in_progress) {
    k_log.debug("Waiting on existing cancellation process");
    try {
      await g_chart_load_promise;
    } catch (ex) {}
    return;
  }

  k_log.info("Canceling star chart loading");

  k_log.debug("Setting chart load cancellation flag");
  g_load_cancellation_in_progress = true;

  g_chart_load_promise = g_chart_load_promise.finally(() => {
    k_log.debug("Clearing chart load cancellation flag");
    g_load_cancellation_in_progress = false;
  });

  try {
    await g_chart_load_promise;
  } catch (ex) {
    k_log.error(ex);
  }

  k_log.debug("Chart load cancellation complete");
}

async function reset({already_within_transaction = false} = {}) {
  await cancel_chart_load();

  g_metadata_loaded = false;

  await m_db.enqueue(async db => {
    k_log.info("Resetting star chart tables");
    await db.run("DELETE FROM waypoint_trait;");
    await db.run("DELETE FROM waypoint_trait_type;");
    await db.run("DELETE FROM waypoint_orbit;");
    await db.run("DELETE FROM waypoint;");
    await db.run("DELETE FROM waypoint_type;");
    await db.run("DELETE FROM waypoint_load;");
    await db.run("DELETE FROM system;");
    await db.run("DELETE FROM system_type;");
    await db.run("DELETE FROM sector;");
    await db.run("DELETE FROM system_load;");

    // All out-of-date data removed.
    await m_server_reset.set_component_is_up_to_date(
      m_server_reset.e_component.star_chart,
      {already_within_transaction: true}
    );
    k_log.debug("Star chart tables reset complete");
  }, {with_transaction: true, already_within_transaction});
}

function handle_chart_load_error(message) {
  k_log.error(message);
  g_chart_load_error_message = message;
  m_server_events.send(m_server_events.e_event_type.star_chart_load_error, {message});
}

function maybe_send_star_chart_progress_event() {
  if (g_has_shutdown) {
    return;
  }
  m_server_events.send(m_server_events.e_event_type.star_chart_load_progress, {
    system_count: g_system_count,
    total_pages_needed: g_total_pages_needed,
    pages_loaded: g_pages_loaded,
    system_waypoints_loaded: g_system_waypoints_loaded,
  });
}

/**
 * Resolves after a few checks are made and any existing load is cancelled. Kicks off the loading
 * of the start chart data, but resolves without waiting for it to complete.
 */
async function start_chart_load(auth_token, server_reset_id) {
  if (g_has_shutdown) {
    k_log.error("Cannot start loading the star chart - component has shut down");
    throw new Error("Cannot start loading the star chart - component has shut down");
  }

  if (server_reset_id != m_server_reset.current_server_reset_id()) {
    k_log.error("Cannot start loading the star chart - agent is out-of-date");
    throw new Error("Cannot start loading the star chart - agent is out-of-date");
  }

  await cancel_chart_load();

  g_chart_load_error_message = null;

  g_chart_load_promise = (async () => {
    k_log.info("Starting star chart loading");

    k_log.debug("Determining system count");
    const response = await m_api.get_systems(auth_token, 1, {page_size: 1});
    if (!response.success) {
      handle_chart_load_error(`Failed to get system count: ${response.error_message}`);
      return;
    }
    g_system_count = response?.payload?.meta?.total;
    if (typeof g_system_count != "number") {
      handle_chart_load_error(
        `Couldn't get valid system count. Got ${JSON.stringify(g_system_count)}`
      );
      return;
    }
    k_log.debug(g_system_count, "systems total");
    
    g_total_pages_needed = await m_db.enqueue(async db => {
      const result = await db.get("SELECT COUNT(*) AS count FROM system_load;");
      return result.count;
    });

    g_system_waypoints_loaded = await m_db.enqueue(async db => {
      const result = await db.get(
        "SELECT COUNT(*) AS count FROM waypoint_load WHERE loaded != 0;"
      );
      return result.count;
    });

    if (g_total_pages_needed < 1) {
      k_log.debug("No page data found - populating system_load database");
      const systems_per_page = m_api.k_max_page_size;

      await m_db.enqueue(async db => {
        let page = 0;
        let remaining_systems = g_system_count;
        while (remaining_systems > 0) {
          page += 1;
          await db.run("INSERT INTO system_load(page_id) VALUES ($page_id);", {$page_id: page});
          remaining_systems -= systems_per_page;
        }
        g_total_pages_needed = page;
      }, {with_transaction: true});

      g_pages_loaded = 0
    } else {
      g_pages_loaded = await m_db.enqueue(async db => {
        const result = await db.get(
          "SELECT COUNT(*) AS count FROM system_load WHERE loaded != 0;"
        );
        return result.count;
      });
    }
    k_log.debug(
      "Have already loaded systems from", g_pages_loaded, "out of", g_total_pages_needed,
      "pages and waypoints for", g_system_waypoints_loaded, "out of", g_system_count, "systems"
    );

    g_metadata_loaded = true;
    maybe_send_star_chart_progress_event();

    while (true) {
      if (g_has_shutdown || g_load_cancellation_in_progress) {
        return;
      }

      const page = await m_db.enqueue(async db => {
        const result = await db.get("SELECT page_id FROM system_load WHERE loaded == 0 LIMIT 1;");
        if (result == undefined) {
          return null;
        }
        return result.page_id;
      });
      if (page == null) {
        if (g_pages_loaded == g_total_pages_needed) {
          k_log.info("All system pages loaded");
          break;
        } else {
          handle_chart_load_error(
            "All system pages loaded, but g_pages_loaded is", g_pages_loaded,
            "and g_total_pages_needed is", g_total_pages_needed
          );
          return;
        }
      }

      if (g_has_shutdown || g_load_cancellation_in_progress) {
        return;
      }

      const response = await m_api.get_systems(auth_token, page);
      if (!response.success) {
        handle_chart_load_error(
          `Failed to retrieve page ${page} of system data: ${response.error_message}`
        );
        return;
      }
      const systems = response.payload.data;
      await m_db.enqueue(async db => {
        for (const system of systems) {
          let result = await db.get("SELECT id FROM sector WHERE symbol = $symbol;", {
            $symbol: system.sectorSymbol,
          });
          let sector_id;
          if (result != undefined) {
            sector_id = result.id;
          } else {
            result = await db.run("INSERT INTO sector(symbol) VALUES ($symbol);", {
              $symbol: system.sectorSymbol,
            });
            sector_id = result.lastID;
          }

          result = await db.get("SELECT id FROM system_type WHERE symbol = $symbol;", {
            $symbol: system.type,
          });
          let type_id;
          if (result != undefined) {
            type_id = result.id;
          } else {
            result = await db.run("INSERT INTO system_type(symbol) VALUES ($symbol);", {
              $symbol: system.type,
            });
            type_id = result.lastID;
          }

          result = await db.run(
            `
              INSERT INTO system(symbol,  sector_id,  type_id,  x,  y)
                         VALUES ($symbol, $sector_id, $type_id, $x, $y);
            `,
            {
              $symbol: system.symbol,
              $sector_id: sector_id,
              $type_id: type_id,
              $x: system.x,
              $y: system.y,
            }
          );
          const system_id = result.lastID;
          await db.run("INSERT INTO waypoint_load(system_id) VALUES ($system_id);", {
            $system_id: system_id
          });
        }
        await db.run("UPDATE system_load SET loaded = 1 WHERE page_id = $page_id;", {
          $page_id: page,
        });
      }, {with_transaction: true});

      g_pages_loaded += 1;
      k_log.debug(
        "Successfully loaded page", page, "(", g_pages_loaded, "out of", g_total_pages_needed, ")"
      );

      maybe_send_star_chart_progress_event();
    }

    while (true) {
      if (g_has_shutdown || g_load_cancellation_in_progress) {
        return;
      }

      const system = await m_db.enqueue(async db => {
        const result = await db.get(
          `
            SELECT system.symbol AS symbol, system.id AS id
            FROM system
            INNER JOIN waypoint_load ON waypoint_load.system_id = system.id
            WHERE waypoint_load.loaded == 0
            LIMIT 1;
          `
        );
        if (result == undefined) {
          return null;
        }
        return result;
      });
      if (system == null) {
        if (g_system_waypoints_loaded == g_system_count) {
          k_log.info("All waypoints loaded");
          break;
        } else {
          handle_chart_load_error(
            "All waypoints loaded, but g_system_waypoints_loaded is", g_system_waypoints_loaded,
            "and g_system_count is", g_system_count
          );
          return;
        }
      }

      const waypoints = [];
      let page = 1;
      while (true) {
        if (g_has_shutdown || g_load_cancellation_in_progress) {
          return;
        }

        const response =
          await m_api.get_waypoints(auth_token, system.symbol, page, m_api.e_priority.map_load);

        if (!response.success) {
          handle_chart_load_error(
            `Failed to get waypoints for ${system.symbol} (p=${page}): ${response.error_message}`
          );
          return;
        }
        waypoints.push(...response.payload.data);
        if (waypoints.length >= response.payload.meta.total) {
          break;
        }
        page += 1;
      }

      await m_db.enqueue(async db => {
        const waypoint_id_lookup = {};
        for (const waypoint of waypoints) {
          let result = await db.get("SELECT id FROM waypoint_type WHERE symbol = $symbol;", {
            $symbol: waypoint.type,
          });
          let type_id;
          if (result != undefined) {
            type_id = result.id;
          } else {
            result = await db.run("INSERT INTO waypoint_type(symbol) VALUES ($symbol);", {
              $symbol: waypoint.type,
            });
            type_id = result.lastID;
          }

          result = await db.run(
            `
              INSERT INTO waypoint(system_id,  symbol,  type_id,  x,  y)
                           VALUES ($system_id, $symbol, $type_id, $x, $y);
            `,
            {
              $system_id: system.id,
              $symbol: waypoint.symbol,
              $type_id: type_id,
              $x: waypoint.x,
              $y: waypoint.y,
            }
          );
          const waypoint_id = result.lastID;
          waypoint_id_lookup[waypoint.symbol] = waypoint_id;

          for (const trait of waypoint.traits) {
            result = await db.get("SELECT id FROM waypoint_trait_type WHERE symbol = $symbol", {
              $symbol: trait.symbol,
            });
            let trait_id;
            if (result != undefined) {
              trait_id = result.id;
            } else {
              result = await db.run(
                `
                  INSERT INTO waypoint_trait_type(symbol,  name,  description)
                                          VALUES ($symbol, $name, $description);
                `,
                {
                  $symbol: trait.symbol,
                  $name: trait.name,
                  $description: trait.description,
                }
              );
              trait_id = result.lastID;
            }
            await db.run(
              "INSERT INTO waypoint_trait(waypoint_id, trait_id) VALUES ($waypoint_id, $trait_id)",
              {$waypoint_id: waypoint_id, $trait_id: trait_id}
            );
          }
        }

        for (const waypoint of waypoints) {
          for (const orbital of waypoint.orbitals) {
            await db.run(
              "INSERT INTO waypoint_orbit(orbited, orbital) VALUES ($orbited, $orbital);",
              {
                $orbited: waypoint_id_lookup[waypoint.symbol],
                $orbital: waypoint_id_lookup[orbital.symbol],
              }
            );
          }
        }

        await db.run("UPDATE waypoint_load SET loaded = 1 WHERE system_id = $system_id;", {
          $system_id: system.id,
        });
      }, {with_transaction: true});

      g_system_waypoints_loaded += 1;
      k_log.debug(
        "Successfully loaded waypoints for system", system.symbol, "(", g_system_waypoints_loaded,
        "out of", g_system_count, ")"
      );

      maybe_send_star_chart_progress_event();
    }

    k_log.info("All loading complete!");
  })().catch(error => {
    handle_chart_load_error(`Uncaught exception: ${error}`);
  }).finally(() => {
    g_chart_load_promise = null;
  });
}

export function status() {
  if (g_chart_load_error_message) {
    return {error_message: g_chart_load_error_message};
  }
  const result = {initialized: g_metadata_loaded};
  if (g_metadata_loaded) {
    result.total_pages_needed = g_total_pages_needed;
    result.pages_loaded = g_pages_loaded;
    result.system_count = g_system_count;
    result.system_waypoints_loaded = g_system_waypoints_loaded;
  }
  return result;
}