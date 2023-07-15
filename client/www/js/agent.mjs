import * as m_api from "./api.mjs";
import * as m_log from "./log.mjs";
import * as m_server from "./server.mjs";
import * as m_storage from "./storage.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "agent");

const k_agent_data_version = 1;
const k_storage_description = {
  key: "id",
  split_public: [
    m_storage.e_store_access.existing_entries,
  ],
  entry_properties: {
    id: {public_access: m_storage.e_entry_access.read_only},
    call_sign: {public_access: m_storage.e_entry_access.read_only},
    auth_token: {public_access: m_storage.e_entry_access.read_only},
  },
  selection: {
    public_access: m_storage.e_entry_access.read_only,
    additional_properties: {
      account_id: {public_access: m_storage.e_entry_access.read_only},
      headquarters: {public_access: m_storage.e_entry_access.read_only},
      credits: {public_access: m_storage.e_entry_access.read_write},
      starting_faction: {public_access: m_storage.e_entry_access.read_only},
    },
  },
};
let g_storage = null;
export let agents = null;

let g_init_promise = null;

export async function init() {
  if (g_init_promise == null) {
    g_init_promise = (async () => {
      [g_storage, agents] = await m_storage.create(
        "agent",
        k_agent_data_version,
        k_storage_description
      );

      const get_response = await m_server.agent.get_all();
      if (!get_response.success) {
        k_log.error("Failed to get agents from server", get_response);
        throw new Error("Failed to get agents from server");
      }

      for (const agent of get_response.result.agents) {
        g_storage.add(agent);
      }

      // This is how we initialize the non-persisted data for the current agent.
      // On failure, we just want to clear the current selection, but this function already
      // effectively does that.
      await set_selected(get_response.result.selected);
    })();
  }
  return g_init_promise;
}

async function add_agent_internal(auth_token, agent_data) {
  const response = await m_server.agent.add(auth_token);
  if (!response.success) {
    return response;
  }

  const agent = {id: response.result.id, call_sign: agent_data.symbol, auth_token};
  await g_storage.add(agent);

  if (response.result.selected) {
    await set_selected_agent_internal(agent.id, agent_data);
  }
  return response;
}

export async function register(call_sign, faction) {
  const response = await m_api.register_agent(call_sign, faction);
  if (!response.success) {
    return response;
  }

  const add_response =
    await add_agent_internal(response.payload.data.token, response.payload.data.agent);
  if (!add_response.success) {
    return add_response;
  }
  return response;
}

export async function add(auth_token) {
  const response = await m_api.get_agent_details(auth_token);
  if (!response.success) {
    return response;
  }

  const add_response = await add_agent_internal(auth_token, response.payload.data);
  if (!add_response.success) {
    return add_response;
  }
  return response;
}

export function format_call_sign(call_sign) {
  return call_sign.toLowerCase();
}

export async function set_selected(agent_id) {
  await g_storage.clear_selection();

  const deselect_response = await m_server.agent.select(null);
  if (!deselect_response.success) {
    return deselect_response;
  }

  if (agent_id == null) {
    return {success: true};
  }

  const agent_data = await g_storage.get(agent_id);
  const response = await m_api.get_agent_details(agent_data.auth_token);
  if (!response.success) {
    return response;
  }

  const select_response = await m_server.agent.select(agent_id);
  if (!select_response.success) {
    return select_response;
  }

  await set_selected_agent_internal(agent_id, response.payload.data);
  return response;
}

async function set_selected_agent_internal(agent_id, agent_data) {
  return g_storage.set_selection({
    id: agent_id,
    call_sign: agent_data.symbol,
    headquarters: agent_data.headquarters,
    credits: agent_data.credits,
    starting_faction: agent_data.startingFaction,
    account_id: agent_data.accountId,
  });
}

export async function remove(agent_id) {
  const response = await m_server.agent.remove(agent_id);
  if (!response.success) {
    return response;
  }

  await g_storage.delete(agent_id);
  return response;
}
