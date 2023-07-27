/**
 * Available interfaces:
 *  server/star_chart/status
 *    Gets the loading status of the star chart loading process.
 *
 *    Parameters:
 *      None
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *          error_message
 *            Present if an error has occurred. Will be a string indicating an error message.
 *          initialized
 *            Present if `error_message` is not present. A boolean indicating whether or not the
 *            star chart component has completed initialization. Note that initialization requires
 *            an authentication token, so cannot complete if no agent has ever been set as the
 *            selected agent.
 *          total_pages_needed
 *            Present if `initialized == true`. Indicates the total number of pages of systems
 *            that need to be loaded.
 *          pages_loaded
 *            Present if `initialized == true`. Indicates the number of pages that have been loaded
 *            so far. When this is equal to `total_pages_needed`, all systems have been loaded.
 *          system_count
 *            Present if `initialized == true`. Indicates the total number of systems.
 *          system_waypoints_loaded
 *            Present if `initialized == true`. Indicates how many systems have had their waypoints
 *            loaded so far. when this is equal to `system_count`, all waypoints have been loaded.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 */
import * as m_log from "../log.mjs";
import * as m_star_chart from "../star_chart.mjs";
import * as m_utils from "../utils.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server/modules/star_chart");

const k_status_command = "status";

export async function handle(url, path_parts, request, request_body, response) {
  if (path_parts.length < 1) {
    m_utils.respond_error(k_log, response, 400, "Star chart module requires a command");
    return;
  }

  const command = path_parts.shift();
  if (path_parts.length > 0) {
    m_utils.respond_error(k_log, response, 400,
                  `Star chart command "${command}" was passed a subcommand but doesn't take one`);
    return;
  }

  if (command == k_status_command) {
    const result = m_star_chart.status();
    const response_object = {success: true, result};
    m_utils.respond_success(k_log, response, response_object);
    return;
  }

  m_utils.respond_error(k_log, response, 404, `Star chart has no such command "${command}"`);
}
