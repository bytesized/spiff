/**
 * Available interfaces:
 *  server/forward
 *    Forwards a request to the SpaceTraders server. When the client wants to make a request, it
 *    should use this method rather than making a request directly so that the server can enforce
 *    request priority and respect SpaceTrader server rate limits.
 *
 *    Parameters:
 *      path
 *        Required. The server path, not including the API version portion of the path (`/v2/`).
 *      query
 *        Optional. The query string to use in the request URL, not including the initial `?`
 *        character.
 *      method
 *        Optional. The REST method to pass to `fetch` via its `options` parameter. If this is
 *        unspecified but `body` is, this will be set to "POST" automatically.
 *      auth_token
 *        Optional. The authentication token to use in the request header.
 *      body
 *        Optional. The request body that will be passed to `fetch` via its `options` parameter.
 *      priority
 *        Optional. If unspecified, defaults to 0 (highest priority). The higher the number
 *        specified, the lower the priority of the request.
 *    Return Format:
 *      Same as the return format of `api_request.dispatch`.
 */
import * as m_api_request from "../api_request.mjs";
import * as m_log from "../log.mjs";
import * as m_utils from "../utils.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server/forward");

export async function handle(url, path_parts, request, request_body, response) {
  if (path_parts.length > 0) {
    m_utils.respond_error(k_log, response, 400,
                          `forward module takes no command but was given "${path_parts[0]}"`);
    return;
  }

  if (!("path" in request_body)) {
    m_utils.respond_error(k_log, response, 400, "Required path was not specified");
    return;
  }

  const options = {};
  if ("query" in request_body) {
    options.query = request_body.query;
  }
  if ("method" in request_body) {
    options.method = request_body.method;
  }
  if ("auth_token" in request_body) {
    options.auth_token = request_body.auth_token;
  }
  if ("body" in request_body) {
    options.body = request_body.body;
  }
  if ("priority" in request_body) {
    options.priority = request_body.priority;
  }
  const st_response = await m_api_request.dispatch(request_body.path, options);
  m_utils.respond_success(k_log, response, st_response);
}
