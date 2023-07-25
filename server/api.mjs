import * as m_api_request from "./api_request.mjs";

export const k_max_page_size = 20;

const e_priority = Object.freeze({
  normal: "e_priority::normal",
  map_load: "e_priority::map_load",
});

const k_priority_int = Object.freeze({
  [e_priority.normal]: 0,
  [e_priority.map_load]: 1,
});

export async function get_metadata() {
  return m_api_request.dispatch("", {priority: k_priority_int[e_priority.normal]});
}

export async function get_agent_details(auth_token) {
  return m_api_request.dispatch(
    "my/agent",
    {auth_token, priority: k_priority_int[e_priority.normal]}
  );
}

export async function register_agent(call_sign, faction) {
  return m_api_request.dispatch(
    "register",
    {body: {symbol: call_sign, faction}, priority: k_priority_int[e_priority.normal]}
  );
}

export async function get_systems(auth_token, page, {page_size = k_max_page_size} = {}) {
  return m_api_request.dispatch(
    "systems",
    {
      query: `page=${page}&limit=${page_size}`,
      auth_token,
      priority: k_priority_int[e_priority.map_load]
    }
  );
}
