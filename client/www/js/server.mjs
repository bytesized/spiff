import * as m_log from "./log.mjs";
import * as m_request_shared from "./shared/request.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server");

async function dispatch(path, body = null) {
  const options = {
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    method: "POST",
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.pathname = "server/" + path;

  k_log.debug("Dispatching request to ", url);
  let result;
  try {
    const response = await fetch(url.href, options);
    k_log.debug("Got response. Waiting for body.");
    result = await response.json();
    k_log.debug("Got full response", result);
  } catch (ex) {
    k_log.debug("Request threw exception:", ex);
    result = {success: false};
    result.error_type = m_request_shared.e_request_error.client_exception;
    result.error_message = m_request_shared.k_request_error_default_message[result.error_type];
  }

  return result;
}

/**
 * @param path
 *        The server path, not including the API version portion of the path (`/v2/`).
 * @param forward_body
 *        An optional object with any of these properties:
 *          query
 *            The query string to use in the request URL, not including the initial `?` character.
 *          method
 *            The REST method to pass to `fetch` via its `options` parameter. If this is
 *            unspecified but `body` is, this will be set to "POST" automatically.
 *          auth_token
 *            The authentication token to use in the request header.
 *          body
 *            The request body that will be passed to `fetch` via its `options` parameter.
 *          priority
 *            If unspecified, defaults to 0 (highest priority). The higher the number specified,
 *            the lower the priority of the request.
 * @returns
 *        An object with the same as the return format of `api_request.dispatch`.
 */
export async function forward(path, forward_body = {}) {
  forward_body.path = path;
  return dispatch("forward", forward_body);
}

export const agent = Object.freeze({
  async add(auth_token) {
    return dispatch("agent/add", {auth_token});
  },

  async get_all() {
    return dispatch("agent/get_all");
  },

  async select(id) {
    return dispatch("agent/select", {id});
  },

  async remove(id) {
    return dispatch("agent/remove", {id});
  },

  async get_server_reset_behavior() {
    return dispatch("agent/get_server_reset_behavior");
  },

  async set_server_reset_behavior(server_reset_behavior) {
    return dispatch("agent/set_server_reset_behavior", {server_reset_behavior});
  },
});

export const star_chart = Object.freeze({
  async status() {
    return dispatch("star_chart/status");
  }
});
