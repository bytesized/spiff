import * as m_api from "./api.mjs";
import * as m_storage from "./storage.mjs";

const k_agents_version = 1;
const k_storage = m_storage.create(
  "agent",
  k_agents_version,
  {
    next_id: {type: m_storage.e_data_type.integer, persist: true},
    available_agents: {type: m_storage.e_data_type.json, persist: true},
    call_sign: {keyed: true, type: m_storage.e_data_type.string, persist: true},
    auth_token: {keyed: true, type: m_storage.e_data_type.string, persist: true},
    current_agent_id: {type: m_storage.e_data_type.string, persist: true},
    current_agent_headquarters: {type:m_storage.e_data_type.string},
    current_agent_credits: {type:m_storage.e_data_type.integer},
    current_agent_starting_faction: {type:m_storage.e_data_type.string},
    current_agent_account_id: {type:m_storage.e_data_type.string},
  }
);

export const k_current = new m_storage.view(
  k_storage,
  {
    id: {from: "current_agent_id", readonly: true},
    call_sign: {key_field: "current_agent_id", readonly: true},
    auth_token: {key_field: "current_agent_id", readonly: true},
    headquarters: {from: "current_agent_headquarters", readonly: true},
    credits: {from: "current_agent_credits", readonly: true},
    starting_faction: {from: "current_agent_starting_faction", readonly: true},
    account_id: {from: "current_agent_account_id", readonly: true},
  }
);

export const k_available = new m_storage.view(
  k_storage,
  {
    ids: {from: "available_agents", readonly: true},
    call_sign: {readonly: true},
    auth_token: {readonly: true},
  }
);

const k_initial_agent_id = 0;

let g_init_promise = null;

export async function init() {
  if (g_init_promise == null) {
    g_init_promise = (async () => {
      if (!k_storage.next_id.is_set()) {
        k_storage.next_id.set(k_initial_agent_id);
      }

      if (!k_storage.available_agents.is_set()) {
        k_storage.available_agents.set([]);
      }

      // This is how we initialize the non-persisted data for the current agent.
      await set_current(k_storage.current_agent_id.get());
    })();
  }
  return g_init_promise;
}

function add_agent_internal(auth_token, agent_data) {
  let agent_id = k_storage.next_id.get();
  k_storage.next_id.set(agent_id + 1);
  agent_id = agent_id.toString();

  k_storage.auth_token.set(agent_id, auth_token);
  k_storage.call_sign.set(agent_id, agent_data.symbol);

  let available_agents = k_storage.available_agents.get();
  available_agents.push(agent_id);
  k_storage.available_agents.set(available_agents);

  if (!k_storage.current_agent_id.is_set()) {
    set_current_agent_internal(agent_id, agent_data);
  }

  return agent_id;
}

export function remove(agent_id) {
  if (k_storage.current_agent_id.get() == agent_id) {
    k_storage.current_agent_id.unset();
  }

  let available_agents = k_storage.available_agents.get();
  available_agents = available_agents.filter(id => id != agent_id);
  k_storage.available_agents.set(available_agents);

  k_storage.auth_token.unset(agent_id);
  k_storage.call_sign.unset(agent_id);
}

export async function create(call_sign, faction) {
  let response = await m_api.register_agent(call_sign, faction);
  if (!response.success) {
    return response;
  }

  add_agent_internal(response.payload.data.token, response.payload.data.agent);
  return response;
}

export async function add(auth_token) {
  let response = await m_api.get_agent_details(auth_token);
  if (!response.success) {
    return response;
  }

  add_agent_internal(auth_token, response.payload.data);
  return response;
}

export function format_call_sign(call_sign) {
  return call_sign.toLowerCase();
}

export async function set_current(agent_id) {
  k_storage.current_agent_id.unset();

  if (agent_id == null) {
    return;
  }

  let auth_token = k_storage.auth_token.get(agent_id);
  let response = await m_api.get_agent_details(auth_token);
  if (!response.success) {
    return response;
  }

  set_current_agent_internal(agent_id, response.payload.data);
  return response;
}

function set_current_agent_internal(agent_id, agent_data) {
  k_storage.current_agent_id.set(agent_id);
  k_storage.call_sign.set(agent_id, agent_data.symbol);
  k_storage.current_agent_headquarters.set(agent_data.headquarters);
  k_storage.current_agent_credits.set(agent_data.credits);
  k_storage.current_agent_starting_faction.set(agent_data.startingFaction);
  k_storage.current_agent_account_id.set(agent_data.accountId);
}
