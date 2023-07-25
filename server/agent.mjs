import * as m_agent_shared from "../client/www/js/shared/agent.mjs";
import * as m_api from "./api.mjs";
import * as m_db from "./db.mjs";
import * as m_log from "./log.mjs";
import * as m_server_reset from "./server_reset.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "server/agent");

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
            server_reset_id INTEGER NOT NULL,
            call_sign TEXT NOT NULL,
            faction TEXT NOT NULL,
            auth_token TEXT NOT NULL,
            removed INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(server_reset_id) REFERENCES server_reset(id)
          );
        `);
        await db.run(`
          CREATE INDEX index_agents_removed ON agents(removed);
        `);
        await db.run(`
          CREATE TABLE tagged_agents(
            tag INTEGER PRIMARY KEY ASC,
            id INTEGER NOT NULL,
            FOREIGN KEY(id) REFERENCES agents(id)
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
 *        server_reset_id
 *          Integer id representing the server reset period during which this agent was created.
 *          Property won't be present if `id` is `null`.
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
                                                      server_reset_id,
                                                      already_within_transaction = false,
                                                     } = {}) {
  if (id != null &&
      (call_sign == undefined || auth_token == undefined || server_reset_id == undefined)
  ) {
    await m_db.enqueue(async db => {
      const result = await db.get(
        "SELECT call_sign, auth_token, server_reset_id FROM agents WHERE id = $id;",
        {$id: id}
      );
      call_sign = result.call_sign;
      auth_token = result.auth_token;
      server_reset_id = result.server_reset_id;
    }, {already_within_transaction});
  }

  const agent = {id};
  if (id != null) {
    agent.call_sign = call_sign;
    agent.auth_token = auth_token;
    agent.server_reset_id = server_reset_id;
  }
  const transaction_options = {already_within_transaction};

  // We want to wait for these listeners. If they don't complete successfully, we need to tell the
  // client that something is wrong.
  for (const listener of g_agent_selection_listeners) {
    await listener(agent, transaction_options);
  }
}

export async function add_agent(auth_token, {already_within_transaction = false} = {}) {
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
    const server_reset_id = m_server_reset.current_server_reset_id();
    let result = await db.run(
      `INSERT INTO agents (server_reset_id,  call_sign,  faction,  auth_token)
                   VALUES ($server_reset_id, $call_sign, $faction, $auth_token);`,
      {
        $server_reset_id: server_reset_id,
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
        {call_sign, auth_token, server_reset_id, already_within_transaction: true}
      );
    }
  }, {with_transaction: true, already_within_transaction});

  response.success = true;
  return response;
}

export async function get_agents({already_within_transaction = false} = {}) {
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
 * Returns `null` if no agent is selected. Otherwise returns an object containing these properties:
 *  id
 *    Integer identifier of the selected agent.
 *  call_sign
 *    String representing the call sign of the agent.
 *  faction
 *    String representing the faction the agent belongs to.
 *  auth_token
 *    String representing the authentication token for the agent.
 *  server_reset_id
 *    An integer representing the id of the server reset period during which the agent was created.
 */
export async function get_selected_agent({already_within_transaction = false} = {}) {
  return m_db.enqueue(async db => {
    const result = await db.get(
      `
        SELECT agents.id AS id, agents.call_sign AS call_sign, agents.faction AS faction,
               agents.auth_token AS auth_token, agents.server_reset_id AS server_reset_id
        FROM agents
        INNER JOIN tagged_agents ON tagged_agents.id = agents.id
        WHERE tag = $tag;
      `,
      {$tag: k_agent_tag_id[e_agent_tag.selected_agent]}
    );
    if (result == undefined) {
      return null;
    }
    return result;
  });
}

/**
 * @param id
 *        Integer id.
 */
export async function select_agent(id, {already_within_transaction = false} = {}) {
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
export async function remove_agent(id, {already_within_transaction = false} = {}) {
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

export async function get_server_reset_behavior({already_within_transaction = false} = {}) {
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
export async function set_server_reset_behavior(server_reset_behavior,
                                                {already_within_transaction = false} = {}) {
  const server_reset_behavior_int = k_server_reset_behavior_to_int[server_reset_behavior];
  await m_db.set_meta_int(m_db.e_meta_int.agent_server_reset_behavior, server_reset_behavior_int,
                          {already_within_transaction});
  return {success: true};
}

export async function enforce_server_reset_behavior({already_within_transaction = false} = {}) {
  await m_db.enqueue(async db => {
    let selected_agent_changed_to = undefined;

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
            selected_agent_changed_to = {
              id: result.lastID,
              call_sign: old_agent.call_sign,
              auth_token: new_agent.auth_token,
              server_reset_id: server_reset_id,
            };
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
      selected_agent_changed_to = null;
    }

    if (selected_agent_changed_to != undefined) {
      if (selected_agent_changed_to == null) {
        await fire_change_agent_selection_listeners(null, {already_within_transaction: true});
      } else {
        await fire_change_agent_selection_listeners(
          selected_agent_changed_to.id,
          {
            call_sign: selected_agent_changed_to.call_sign,
            auth_token: selected_agent_changed_to.auth_token,
            server_reset_id: selected_agent_changed_to.server_reset_id,
            already_within_transaction: true
          }
        );
      }
    }
  }, {with_transaction: true, already_within_transaction});
}
