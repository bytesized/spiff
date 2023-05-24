import * as m_storage from "./storage.mjs";

const k_module_name = "agent";
// This should be incremented whenever the data format stored in `m_storage` changes.
const k_module_version = 1;

const k_storage = m_storage.create(k_module_name, k_module_version);

const k_next_agent_id_key = "next_agent_id";
const k_initial_agent_id = 0;
const k_available_agent_list_key = "available_agents";
const k_agent_data_key_prefix = "agent_data|";
const k_selected_agent_key = "selected_agent";

function init() {
  if (!k_storage.has(k_next_agent_id_key)) {
    k_storage.write_int(k_next_agent_id_key, k_initial_agent_id);
  }

  if (!k_storage.has(k_available_agent_list_key)) {
    k_storage.write_json(k_available_agent_list_key, []);
  }
}

/**
 * @returns
 *        A list of string id's.
 */
export function get_available() {
  return k_storage.read_json(k_available_agent_list_key);
}

function set_available(agents) {
  k_storage.write_json(k_available_agent_list_key, agents);
}

/**
 * @returns
 *        A string id, or null if no agent is selected.
 */
export function get_selected() {
  return k_storage.read(k_selected_agent_key);
}

export function set_selected(agent_id) {
  k_storage.write(k_selected_agent_key, agent_id);
}

export function clear_selected() {
  k_storage.remove(k_selected_agent_key);
}

/**
 * @param agent_id
 *        An agent id retrieved via `get_available()` or `get_selected()`.
 * @return
 *        An object with these properties:
 *          auth_token
 *            The token used to authenticate as an agent.
 *          call_sign
 *            The call sign of the agent.
 */
export function get_cached_agent_data(agent_id) {
  return k_storage.read_json(k_agent_data_key_prefix + agent_id.toString());
}

function set_cached_agent_data(agent_id, data) {
  k_storage.write_json(k_agent_data_key_prefix + agent_id.toString(), data);
}

export function update_cached_agent_data(agent_id, update) {
  let existing = get_cached_agent_data(agent_id);
  set_cached_agent_data(agent_id, Object.assign(existing, update));
}

function clear_cached_agent_data(agent_id) {
  k_storage.remove(k_agent_data_key_prefix + agent_id.toString());
}

export function add(auth_token, call_sign) {
  let agent_id = k_storage.read_int(k_next_agent_id_key);
  k_storage.write_int(k_next_agent_id_key, agent_id + 1);
  agent_id = agent_id.toString();

  set_cached_agent_data(agent_id, {auth_token, call_sign});

  let available_agents = get_available();
  available_agents.push(agent_id);
  set_available(available_agents);

  if (get_selected() == null) {
    set_selected(agent_id);
  }

  return agent_id;
}

export function remove(agent_id) {
  clear_cached_agent_data(agent_id);

  let available_agents = get_available();
  available_agents = available_agents.filter(id => id != agent_id);
  set_available(available_agents);

  if (get_selected() == agent_id) {
    clear_selected();
  }
}

init();
