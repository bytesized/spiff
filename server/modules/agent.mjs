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
import * as m_agent_shared from "../../client/www/js/shared/agent.mjs";
import * as m_api from "../api.mjs";
import * as m_db from "../db.mjs";
import * as m_log from "../log.mjs";
import * as m_server_reset from "../server_reset.mjs";
import * as m_utils from "../utils.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server/agent");

const k_add_agent_command = "add";
const k_get_all_command = "get_all";
const k_select_command = "select";
const k_remove_command = "remove";
const k_get_server_reset_behavior_command = "get_server_reset_behavior";
const k_set_server_reset_behavior_command = "set_server_reset_behavior";

const k_agent_db_current_version = 1;

const e_agent_tag = Object.freeze({
  selected_agent: "e_agent_tag::selected_agent",
});
const k_agent_tag_id = Object.freeze({
  [e_agent_tag.selected_agent]: 1,
});

// Maps between enumerated server reset behaviors and integers for conversion to and from the
// `meta_int` table.
const k_int_to_server_reset_behavior = Object.freeze([
  m_agent_shared.e_server_reset_behavior.ignore,
  m_agent_shared.e_server_reset_behavior.remove,
  m_agent_shared.e_server_reset_behavior.recreate,
]);
const k_server_reset_behavior_to_int = Object.freeze(
  Object.fromEntries(k_int_to_server_reset_behavior.map((b, i) => [b, i]))
);
const k_default_server_reset_behavior = m_agent_shared.e_server_reset_behavior.ignore;

let g_agent_selection_listeners = [];

export async function init(args) {
  await m_db.enqueue(async db => {
    let agent_db_version = await m_db.get_meta_int(m_db.e_meta_int.agent_module_version,
                                                   {already_within_transaction: true});
    if (agent_db_version == null) {
      // 0 will signify that the agent tables have never been created so that we can always compare
      // version numbers with numeric comparison operators.
      agent_db_version = 0;
    }

    if (agent_db_version > k_agent_db_current_version) {
      throw new Error(
        `Software Downgrade Error: agent table is version ${agent_db_version}, but the software ` +
        `only supports up to version ${k_agent_db_current_version}`
      );
    } else if (agent_db_version < k_agent_db_current_version) {
      if (agent_db_version < 1) {
        await db.run(`
          CREATE TABLE agents(
            id INTEGER PRIMARY KEY ASC,
            server_reset_id NOT NULL REFERENCES server_reset(id),
            call_sign TEXT NOT NULL,
            faction TEXT NOT NULL,
            auth_token TEXT NOT NULL,
            removed INTEGER NOT NULL DEFAULT 0
          );
        `);
        await db.run(`
          CREATE INDEX index_agents_removed ON agents(removed);
        `);
        await db.run(`
          CREATE TABLE tagged_agents(
            tag INTEGER PRIMARY KEY ASC,
            id NOT NULL REFERENCES agents(id)
          );
        `);
      }

      await m_db.set_meta_int(m_db.e_meta_int.agent_module_version, k_agent_db_current_version,
                              {already_within_transaction: true});

      const server_reset_behavior = await m_db.get_meta_int(
        m_db.e_meta_int.agent_server_reset_behavior,
        {already_within_transaction: true}
      );
      if (server_reset_behavior == null) {
        await m_db.set_meta_int(m_db.e_meta_int.agent_server_reset_behavior,
                                k_server_reset_behavior_to_int[k_default_server_reset_behavior],
                                {already_within_transaction: true});
      }
    }

    enforce_server_reset_behavior({already_within_transaction: true});
  }, {with_transaction: true});

  m_server_reset.add_reset_complete_listener(server_reset => {
    enforce_server_reset_behavior();
  });
}

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
    const response_object = await add_agent(request_body.auth_token);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_get_all_command) {
    const response_object = await get_agents();
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_select_command) {
    const id = convert_string_id_or_respond_error(request_body.id);
    if (isNaN(id)) {return;}
    const response_object = await select_agent(id);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_remove_command) {
    const id = convert_string_id_or_respond_error(request_body.id);
    if (isNaN(id)) {return;}
    const response_object = await remove_agent(id);
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_get_server_reset_behavior_command) {
    const response_object = await get_server_reset_behavior();
    m_utils.respond_success(k_log, response, response_object);
    return;
  } else if (command == k_set_server_reset_behavior_command) {
    const response_object = await set_server_reset_behavior(request_body.server_reset_behavior);
    m_utils.respond_success(k_log, response, response_object);
    return;
  }

  m_utils.respond_error(k_log, response, 404, `Agent has no such command "${command}"`);
}

/**
 * Added listeners will be called when the agent selection changes. Arguments passed to the
 * listener will be:
 *    agent
 *      An object with the following properties:
 *        id
 *          Integer id representing the agent, or `null` if no agent is now selected.
 *        call_sign
 *          The agent's call sign. Property won't be present if `id` is `null`.
 *        auth_token
 *          The agent's authentication token. Property won't be present if `id` is `null`.
 *    transaction_options
 *      An object containing the following properties:
 *        already_within_transaction
 *          Will be `true` if the listener is running within a database transaction, else `false`.
 */
export function add_change_agent_selection_listener(fn) {
  g_agent_selection_listeners.push(fn);
}

async function fire_change_agent_selection_listeners(id,
                                                     {
                                                      call_sign,
                                                      auth_token,
                                                      already_within_transaction = false,
                                                     } = {}) {
  if (id != null && (call_sign == undefined || auth_token == undefined)) {
    await m_db.enqueue(async db => {
      const result = await db.get("SELECT call_sign, auth_token FROM agents WHERE id = $id;", {
        $id: id,
      });
      call_sign = result.call_sign;
      auth_token = result.auth_token;
    }, {already_within_transaction});
  }

  const agent = {id};
  if (id != null) {
    agent.call_sign = call_sign;
    agent.auth_token = auth_token;
  }
  const transaction_options = {already_within_transaction};

  // We want to wait for these listeners. If they don't complete successfully, we need to tell the
  // client that something is wrong.
  for (const listener of g_agent_selection_listeners) {
    await listener(agent, transaction_options);
  }
}

async function add_agent(auth_token, {already_within_transaction = false} = {}) {
  const response = {};
  const server_response = await m_api.get_agent_details(auth_token);
  response.st_response = server_response;
  if (!server_response.success) {
    response.success = false;
    response.error = {message: server_response.error_message};
    return response;
  }
  const call_sign = server_response?.payload?.data?.symbol;
  if (typeof call_sign != "string") {
    response.success = false;
    response.error = {message: "Call sign is not present or not a string"};
    return response;
  }
  const faction = server_response?.payload?.data?.startingFaction;
  if (typeof call_sign != "string") {
    response.success = false;
    response.error = {message: "Faction is not present or not a string"};
    return response;
  }

  await m_db.enqueue(async db => {
    let result = await db.run(
      `INSERT INTO agents (server_reset_id,  call_sign,  faction,  auth_token)
                   VALUES ($server_reset_id, $call_sign, $faction, $auth_token);`,
      {
        $server_reset_id: m_server_reset.current_server_reset_id(),
        $call_sign: call_sign,
        $faction: faction,
        $auth_token: auth_token,
      }
    );
    const agent_id = result.lastID;
    response.result = {id: agent_id.toString()};

    result = await db.run("INSERT OR IGNORE INTO tagged_agents (tag, id) VALUES ($tag, $id);", {
      $tag: k_agent_tag_id[e_agent_tag.selected_agent],
      $id: agent_id,
    });
    response.result.selected = result.lastID == k_agent_tag_id[e_agent_tag.selected_agent];

    if (response.result.selected) {
      await fire_change_agent_selection_listeners(
        agent_id,
        {call_sign, auth_token, already_within_transaction: true}
      );
    }
  }, {with_transaction: true, already_within_transaction});

  response.success = true;
  return response;
}

async function get_agents({already_within_transaction = false} = {}) {
  const response = {result:{}};

  await m_db.enqueue(async db => {
    const agents = await db.all(
      "SELECT id, call_sign, auth_token FROM agents WHERE removed = 0 ORDER BY id ASC;"
    );
    response.result.agents = [];
    for (const {id, call_sign, auth_token} of agents) {
      response.result.agents.push({id: id.toString(), call_sign, auth_token});
    }

    const selected_agent = await get_selected_agent_id({already_within_transaction: true});
    if (selected_agent == null) {
      response.result.selected = null;
    } else {
      response.result.selected = selected_agent.toString();
    }
  }, {with_transaction: true, already_within_transaction});

  response.success = true;
  return response;
}

/**
 * Returns `null` if no agent is selected, otherwise returns the selected agent id as an integer.
 */
export async function get_selected_agent_id({already_within_transaction = false} = {}) {
  return m_db.enqueue(async db => {
    const result = await db.get("SELECT id FROM tagged_agents WHERE tag = $tag;", {
      $tag: k_agent_tag_id[e_agent_tag.selected_agent],
    });
    if (result == undefined) {
      return null;
    }
    return result.id;
  }, {already_within_transaction});
}

/**
 * @param id
 *        Integer id.
 */
async function select_agent(id, {already_within_transaction = false} = {}) {
  const response = {success: true};

  await m_db.enqueue(async db => {
    if (id == null) {
      const result = await db.run("DELETE FROM tagged_agents WHERE tag = $tag;", {
        $tag: k_agent_tag_id[e_agent_tag.selected_agent],
      });

      if (result.changes > 0) {
        await fire_change_agent_selection_listeners(id, {already_within_transaction: true});
      }
    } else {
      const selected_agent = await get_selected_agent_id({already_within_transaction: true});
      if (selected_agent == id) {
        return;
      }

      const result = await db.get("SELECT removed FROM agents WHERE id = $id;", {$id: id});
      if (result == undefined || result.removed != 0) {
        response.success = false;
        response.error_message = `No agent with id "${id}"`;
        return;
      }

      await db.run("INSERT OR REPLACE INTO tagged_agents (tag, id) VALUES ($tag, $id);", {
        $tag: k_agent_tag_id[e_agent_tag.selected_agent],
        $id: id,
      });
      await fire_change_agent_selection_listeners(id, {already_within_transaction: true});
    }
  }, {with_transaction: true, already_within_transaction});

  return response;
}

/**
 * @param id
 *        Integer id.
 */
async function remove_agent(id, {already_within_transaction = false} = {}) {
  const response = {};

  await m_db.enqueue(async db => {
    const result = await db.run("DELETE FROM tagged_agents WHERE tag = $tag AND id = $id;", {
      $tag: k_agent_tag_id[e_agent_tag.selected_agent],
      $id: id,
    });
    const agent_was_selected = result.changes > 0;

    await db.run("UPDATE agents SET removed = 1 WHERE id = $id;", {
      $id: id,
    });

    if (agent_was_selected) {
      await fire_change_agent_selection_listeners(null, {already_within_transaction: true});
    }
  }, {with_transaction: true, already_within_transaction});

  response.success = true;
  return response;
}

async function get_server_reset_behavior({already_within_transaction = false} = {}) {
  const server_reset_behavior_int = await m_db.get_meta_int(
    m_db.e_meta_int.agent_server_reset_behavior,
    {already_within_transaction}
  );
  const server_reset_behavior = k_int_to_server_reset_behavior[server_reset_behavior_int];

  return {success: true, result: {server_reset_behavior}};
}

/**
 * @param server_reset_behavior
 *        A value from `m_agent_shared.e_server_reset_behavior`.
 */
async function set_server_reset_behavior(server_reset_behavior,
                                         {already_within_transaction = false} = {}) {
  const server_reset_behavior_int = k_server_reset_behavior_to_int[server_reset_behavior];
  await m_db.set_meta_int(m_db.e_meta_int.agent_server_reset_behavior, server_reset_behavior_int,
                          {already_within_transaction});
  return {success: true};
}

async function enforce_server_reset_behavior({already_within_transaction = false} = {}) {
  await m_db.enqueue(async db => {
    const server_reset_behavior_int = await m_db.get_meta_int(
      m_db.e_meta_int.agent_server_reset_behavior,
      {already_within_transaction: true}
    );
    const server_reset_id = m_server_reset.current_server_reset_id();
    const server_reset_behavior = k_int_to_server_reset_behavior[server_reset_behavior_int];
    if (server_reset_behavior == m_agent_shared.e_server_reset_behavior.remove) {
      k_log.info("Removing stale agents");
      const result = await db.run(
        "UPDATE agents SET removed = 1 WHERE server_reset_id != $server_reset_id AND removed = 0",
        {$server_reset_id: server_reset_id}
      );
      k_log.info_if(result.changes > 0, "Removed", result.changes, "stale agents");
    } else if (server_reset_behavior == m_agent_shared.e_server_reset_behavior.recreate) {
      const agents = await db.all(
        `
          SELECT id, call_sign, faction
          FROM agents
          WHERE removed = 0 AND server_reset_id != $server_reset_id
          ORDER BY id ASC;
        `,
        {$server_reset_id: server_reset_id}
      );
      const selected_id =
        (await db.get("SELECT id FROM tagged_agents WHERE tag = $tag;",
                      {$tag: k_agent_tag_id[e_agent_tag.selected_agent]}))?.id ?? null;

      const result = await db.run(
        "UPDATE agents SET removed = 1 WHERE server_reset_id != $server_reset_id AND removed = 0",
        {$server_reset_id: server_reset_id}
      );
      k_log.info_if(result.changes > 0, "Removed", result.changes, "stale agents");

      const agent_lookup = {};
      for (const agent of agents) {
        agent_lookup[agent.call_sign] = agent;
      }
      const created_agents = {};
      for (const call_sign in agent_lookup) {
        k_log.info("Recreating agent:", call_sign);
        const response = await m_api.register_agent(call_sign, agent_lookup[call_sign].faction);
        if (response.success) {
          created_agents[response.payload.data.agent.symbol] = {
            faction: response.payload.data.agent.startingFaction,
            auth_token: response.payload.data.token
          };
          k_log.debug("Agent created successfully");
        } else {
          k_log.warn("Failed to recreate agent:", response.error_message);
        }
      }
      for (const old_agent of agents) {
        if ((old_agent.call_sign) in created_agents) {
          const new_agent = created_agents[old_agent.call_sign];
          const result = await db.run(
            `
              INSERT INTO agents (server_reset_id,  call_sign,  faction,  auth_token)
                          VALUES ($server_reset_id, $call_sign, $faction, $auth_token);
            `,
            {
              $server_reset_id: server_reset_id,
              $call_sign: old_agent.call_sign,
              $faction: new_agent.faction,
              $auth_token: new_agent.auth_token,
            }
          );
          if (old_agent.id == selected_id) {
            await db.run("INSERT OR REPLACE INTO tagged_agents (tag, id) VALUES ($tag, $id);", {
              $tag: k_agent_tag_id[e_agent_tag.selected_agent],
              $id: result.lastID,
            });
          }
        }
      }
    }

    // If the selected agent has been removed, deselect it.
    const result = await db.get(`
        SELECT a.removed
        FROM agents a
        INNER JOIN tagged_agents t
          ON a.id = t.id
        WHERE t.tag = $tag
      `,
      {$tag: k_agent_tag_id[e_agent_tag.selected_agent]}
    );
    if (result != undefined && result.removed != 0) {
      k_log.debug("Clearing selection from removed agent");
      await db.run("DELETE FROM tagged_agents WHERE tag = $tag;", {
        $tag: k_agent_tag_id[e_agent_tag.selected_agent],
      });
    }
  }, {with_transaction: true, already_within_transaction});
}
