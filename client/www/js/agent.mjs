import * as m_api from "./api.mjs";
import * as m_storage from "./storage.mjs";

const k_agent_data_version = 1;
const k_storage_description = {
  key: "id",
  generated_key: true,
  split_public: [
    m_storage.e_store_access.existing_entries,
    m_storage.e_store_access.remove_entries,
    m_storage.e_store_access.clear_selection,
  ],
  entry_properties: {
    id: {persist: true, public_access: m_storage.e_entry_access.read_only},
    call_sign: {persist: true, public_access: m_storage.e_entry_access.read_only},
    auth_token: {persist: true, public_access: m_storage.e_entry_access.read_only},
  },
  selection: {
    public_access: m_storage.e_entry_access.read_only,
    persist_to_store: m_storage.k_agent_current_store_name,
    additional_properties: {
      account_id: {persist: true, public_access: m_storage.e_entry_access.read_only},
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
        m_storage.k_agent_store_name,
        k_agent_data_version,
        k_storage_description
      );

      // This is how we initialize the non-persisted data for the current agent.
      await set_selected(await g_storage.get_selection_key());
    })();
  }
  return g_init_promise;
}

async function add_agent_internal(auth_token, agent_data) {
  let agent = {call_sign: agent_data.symbol, auth_token};
  await g_storage.add(agent);

  const selected = await g_storage.get_selection_key();
  if (selected == null) {
    await set_selected_agent_internal(agent.id, agent_data);
  }
  return agent.id;
}

export async function register(call_sign, faction) {
  let response = await m_api.register_agent(call_sign, faction);
  if (!response.success) {
    return response;
  }

  await add_agent_internal(response.payload.data.token, response.payload.data.agent);
  return response;
}

export async function add(auth_token) {
  let response = await m_api.get_agent_details(auth_token);
  if (!response.success) {
    return response;
  }

  await add_agent_internal(auth_token, response.payload.data);
  return response;
}

export function format_call_sign(call_sign) {
  return call_sign.toLowerCase();
}

export async function set_selected(agent_id) {
  await g_storage.clear_selection();
  if (agent_id == null) {
    return null;
  }

  const agent_data = await g_storage.get(agent_id);
  const response = await m_api.get_agent_details(agent_data.auth_token);
  if (!response.success) {
    return response;
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
