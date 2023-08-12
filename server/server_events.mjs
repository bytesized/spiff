/**
 * Unlike most other server components, this one is initialized and shutdown by app.mjs directly
 * rather than by server/index.mjs.
 */
import * as m_log from "./log.mjs";
import * as m_server_events_shared from "../client/www/js/shared/server_events.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.info, "server/server_events");

export const e_event_type = m_server_events_shared.e_event_type;

let g_server_io;

export async function init(args, server_io) {
  g_server_io = server_io;
}

export async function shutdown() {
  g_server_io = null;
}

export function send(event, ...args) {
  k_log.debug("Emitting event:", event, "With args:", args);
  g_server_io.emit(event, ...args);
}
