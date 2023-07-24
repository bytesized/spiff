/**
 * Available interfaces:
 *  server/agent/add
 *    Adds an agent to the list of available agents.
 *
 *    Parameters:
 *      auth_token
 *        The authentication token for the agent to be added.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *          id
 *            A string identifier assigned to the user when added to the database. Used to identify
 *            the user on subsequent requests.
 *          selected
 *            Boolean indicating whether or not the added agent is now the selected agent.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *      st_response
 *        Present if a request was made to the SpaceTraders server. Will contain the response. Will
 *        always be present if `success == true`.
 *
 *  server/agent/get_all
 *    Returns all agents that have been added (and not removed) along with with agent is selected.
 *
 *    Parameters:
 *      None
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *
 *        agents
 *          An array of objects, each of which will contain these keys:
 *            id
 *              A string identifier associated with the agent.
 *            call_sign
 *              A string representing the name of the agent, as it was registered with the
 *              SpaceTraders server.
 *            auth_token
 *              The token to authenticate as the agent on the SpaceTraders server.
 *        selected
 *          Either the id of the agent that is selected or `null` if no agent is selected.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/agent/select
 *    Sets the specified agent as the selected agent.
 *
 *    Parameters:
 *      id
 *        The string identifier associated with the agent to select, or `null` if current selection
 *        should be unset.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/agent/remove
 *    Removes the specified agent.
 *
 *    Parameters:
 *      id
 *        The string identifier associated with the agent to remove.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/agent/get_server_reset_behavior
 *    Retrieves the configuration determining what will be done with (now invalid) agent data when
 *    the server is reset.
 *
 *    Parameters:
 *      None
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      result
 *        Present if `success == true`. Will be an object containing these keys:
 *          server_reset_behavior
 *            A value from `m_agent_shared.e_server_reset_behavior`.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 *
 *  server/agent/set_server_reset_behavior
 *    Retrieves the configuration determining what will be done with (now invalid) agent data when
 *    the server is reset.
 *
 *    Parameters:
 *      server_reset_behavior
 *        A value from `m_agent_shared.e_server_reset_behavior`.
 *    Return Format:
 *      success
 *        Boolean indicating whether or not the request succeeded.
 *      error_message
 *        Present if `success == false`. A string error message indicating why the request failed.
 */
import * as m_agent from "../agent.mjs";
import * as m_log from "../log.mjs";
import * as m_utils from "../utils.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server/modules/agent");

const k_add_agent_command = "add";
const k_get_all_command = "get_all";
const k_select_command = "select";
const k_remove_command = "remove";
const k_get_server_reset_behavior_command = "get_server_reset_behavior";
const k_set_server_reset_behavior_command = "set_server_reset_behavior";

/**
 * Either returns `null`, an integer id, or returns `NaN` and responds automatically with failure.
 */
function convert_string_id_or_respond_error(id, response) {
  if (id == null) {
    return null;
  }
  const id_int = parseInt(id, 10);
  if (isNaN(id_int)) {
    const message = "id should be an integer, but was instead: " + JSON.stringify(id);
    k_log.warn(message);
    response.writeHead(400, {"Content-Type": "application/json"});
    response.end(JSON.stringify({success: false, error: {message}}));
  }
  return id_int;
}

export async function handle(url, path_parts, request, request_body, response) {
  if (path_parts.length < 1) {
    m_utils.respond_error(k_log, response, 400, "Agent module requires a command");
    return;
  }

  const command = path_parts.shift();
  if (path_parts.length > 0) {
    m_utils.respond_error(k_log, response, 400,
                  `Agent command "${command}" was passed a subcommand but doesn't take one`);
    return;
  }

  if (command == k_add_agent_command) {
    const response_object = await m_agent.add_agent(request_body.auth_token);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_get_all_command) {
    const response_object = await m_agent.get_agents();
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_select_command) {
    const id = convert_string_id_or_respond_error(request_body.id);
    if (isNaN(id)) {return;}
    const response_object = await m_agent.select_agent(id);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_remove_command) {
    const id = convert_string_id_or_respond_error(request_body.id);
    if (isNaN(id)) {return;}
    const response_object = await m_agent.remove_agent(id);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_get_server_reset_behavior_command) {
    const response_object = await m_agent.get_server_reset_behavior();
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_set_server_reset_behavior_command) {
    const response_object =
      await m_agent.set_server_reset_behavior(request_body.server_reset_behavior);
    m_utils.respond_success(k_log, response, response_object);
    return;
  }

  m_utils.respond_error(k_log, response, 404, `Agent has no such command "${command}"`);
}
