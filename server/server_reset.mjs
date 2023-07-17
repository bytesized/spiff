import * as m_api from "./api.mjs";
import * as m_db from "./db.mjs";
import * as m_log from "./log.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server_reset");

const k_server_reset_db_current_version = 1;

const k_first_server_reset_id = 1;
let g_current_server_reset_id;

export async function init(args) {
  const metadata_response = await m_api.get_metadata();
  if (!metadata_response.success) {
    throw new Error(`Failed to get server metadata: ${metadata_response.error_message}`);
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
          $last_reset: metadata_response.payload.resetDate,
          $next_reset: metadata_response.payload.serverResets?.next ?? null,
        }
      );
      g_current_server_reset_id = result.lastID;
    } else {
      g_current_server_reset_id = result.current;
      result = await db.get("SELECT last_reset FROM server_reset WHERE id = $id;", {
        $id: g_current_server_reset_id,
      });
      if (result.last_reset != metadata_response.payload.resetDate) {
        k_log.info("Server reset since last run");
        result = await db.run(
          `INSERT INTO server_reset(id,  last_reset,  next_reset)
                            VALUES ($id, $last_reset, $next_reset);`,
          {
            $id: g_current_server_reset_id + 1,
            $last_reset: metadata_response.payload.resetDate,
            $next_reset: metadata_response.payload.serverResets?.next ?? null,
          }
        );
        g_current_server_reset_id = result.lastID;
      }
    }
  }, {with_transaction: true});
}

export function current_server_reset_id() {
  return g_current_server_reset_id;
}
