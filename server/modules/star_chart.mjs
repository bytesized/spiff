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
 *
 *  server/star_chart/waypoints
 *    Gets the waypoints in a system. This should not be used until all systems have been loaded
 *    (`server/star_chart/status` returns `initialized && total_pages_needed == pages_loaded`).
 *
 *    Parameters:
 *      auth_token
 *        The authentication token to use to load star chart data from the ST servers, if
 *        necessary.
 *      system_symbol
 *        A string symbol indicating the system to retrieve the waypoints for.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *          system
 *            An object describing the system that all the returned waypoints are in. It will
 *            contain these keys:
 *              id
 *                The database id of the system.
 *              symbol
 *                The symbol representing the system.
 *              position
 *                An object describing the position of the system. Will contain these keys:
 *                  x
 *                    The x coordinate of the system.
 *                  y
 *                    The y coordinate of the system.
 *          waypoints
 *            An object containing one entry per waypoint. For each, the key will be the waypoint
 *            symbol and the value will be an object with these keys:
 *              id
 *                The database id of the waypoint.
 *              orbitals
 *                An array of waypoints that orbit this one.
 *              orbits
 *                If this waypoint orbits another waypoint, this will be the symbol of the waypoint
 *                that it orbits. Otherwise this will be `null`.
 *              symbol
 *                The symbol of the waypoint.
 *              traits
 *                An array of waypoint trait objects, each of which have these keys:
 *                  symbol
 *                    The trait symbol.
 *                  name
 *                    The name of the trait.
 *                  description
 *                    The description of the trait.
 *              type
 *                An object describing the type that the waypoint is in. Will contain these keys:
 *                  id
 *                    The database id of the type of this waypoint.
 *                  symbol
 *                    The symbol of the waypoint type.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/star_chart/sibling_waypoints
 *    Gets all the waypoints in the same system as a given waypoint. This should not be used until
 *    all systems have been loaded (`server/star_chart/status` returns
 *    `initialized && total_pages_needed == pages_loaded`).
 *
 *    Parameters:
 *      auth_token
 *        The authentication token to use to load star chart data from the ST servers, if
 *        necessary.
 *      waypoint_symbol
 *        A string symbol indicating the waypoints to retrieve the siblings of.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *          system
 *            An object describing the system that all the returned waypoints are in. It will
 *            contain these keys:
 *              id
 *                The database id of the system.
 *              symbol
 *                The symbol representing the system.
 *              position
 *                An object describing the position of the system. Will contain these keys:
 *                  x
 *                    The x coordinate of the system.
 *                  y
 *                    The y coordinate of the system.
 *          waypoints
 *            An object containing one entry per waypoint. For each, the key will be the waypoint
 *            symbol and the value will be an object with these keys:
 *              id
 *                The database id of the waypoint.
 *              orbitals
 *                An array of waypoints that orbit this one.
 *              orbits
 *                If this waypoint orbits another waypoint, this will be the symbol of the waypoint
 *                that it orbits. Otherwise this will be `null`.
 *              symbol
 *                The symbol of the waypoint.
 *              traits
 *                An array of waypoint trait objects, each of which have these keys:
 *                  symbol
 *                    The trait symbol.
 *                  name
 *                    The name of the trait.
 *                  description
 *                    The description of the trait.
 *              type
 *                An object describing the type that the waypoint is in. Will contain these keys:
 *                  id
 *                    The database id of the type of this waypoint.
 *                  symbol
 *                    The symbol of the waypoint type.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/star_chart/local_systems
 *    Gets all the systems in a given rectangle. This probably should not be used until all systems
 *    have been loaded (`server/star_chart/status` returns
 *    `initialized && total_pages_needed == pages_loaded`).
 *
 *    Parameters:
 *      min_x
 *        Leftmost x coordinate of the rectangle to return systems in.
 *      max_x
 *        Rightmost x coordinate of the rectangle to return systems in.
 *      min_y
 *        Topmost y coordinate of the rectangle to return systems in.
 *      max_y
 *        Bottom-most y coordinate of the rectangle to return systems in.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing one entry per system. For
 *        each, the key will be the system symbol and the value will be an object with these keys:
 *          sector
 *            An object describing the sector that the system is in. Will contain these keys:
 *              id
 *                The database id of the sector.
 *              symbol
 *                The symbol of the sector.
 *          type
 *            An object describing the type of system. Will contain these keys:
 *              id
 *                The database id of the system type.
 *              symbol
 *                The symbol of the system type.
 *          id
 *            The database id of the system.
 *          symbol
 *            The symbol representing the system.
 *          position
 *            An object describing the position of the system. Will contain these keys:
 *              x
 *                The x coordinate of the system.
 *              y
 *                The y coordinate of the system.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 */
import * as m_log from "../log.mjs";
import * as m_star_chart from "../star_chart.mjs";
import * as m_utils from "../utils.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.warn, "server/modules/star_chart");

const k_status_command = "status";
const k_waypoints_command = "waypoints";
const k_sibling_waypoints_command = "sibling_waypoints";
const k_local_systems_command = "local_systems";

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
  } else if (command == k_waypoints_command) {
    const response_object = await m_star_chart.get_system_waypoints(request_body.auth_token,
                                                                    request_body.system_symbol);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_sibling_waypoints_command) {
    const response_object = await m_star_chart.get_sibling_waypoints(request_body.auth_token,
                                                                     request_body.waypoint_symbol);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_local_systems_command) {
    const response_object = await m_star_chart.get_local_systems(
      request_body.min_x, request_body.max_x, request_body.min_y, request_body.max_y
    );
    m_utils.respond_success(k_log, response, response_object);
    return;
  }

  m_utils.respond_error(k_log, response, 404, `Star chart has no such command "${command}"`);
}
