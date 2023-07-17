import * as m_api_request from "./api_request.mjs";

export async function get_metadata() {
  return m_api_request.dispatch("");
}

export async function get_agent_details(auth_token) {
  return m_api_request.dispatch("my/agent", {auth_token});
}

export async function register_agent(call_sign, faction) {
  return m_api_request.dispatch("register", {body: {symbol: call_sign, faction}});
}
