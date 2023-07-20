import * as m_log from "./log.mjs";
import * as m_server_events_shared from "./shared/server_events.mjs";
import * as m_socket_io from "/socket.io/socket.io.esm.min.js";

const k_log = new m_log.logger(m_log.e_log_level.info, "server_events");

export const e_event_type = m_server_events_shared.e_event_type;

const g_listeners = {};

let g_socket;

export async function init() {
  g_socket = m_socket_io.io();

  for (const event of Object.values(e_event_type)) {
    g_listeners[event] = [];

    g_socket.on(event, (...args) => {
      k_log.debug("Got event:", event, "with args:", args);
      for (const listener of g_listeners[event]) {
        try {
          listener(...args);
        } catch (ex) {
          k_log.error(ex);
        }
      }
    });
  }
}

export function add_listener(event, listener) {
  g_listeners[event].push(listener);
}
