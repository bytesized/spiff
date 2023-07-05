import * as m_server from "./server.mjs";

export async function get_agent_details(auth_token) {
  return m_server.forward("my/agent", {auth_token});
}

export async function register_agent(call_sign, faction) {
  return m_server.forward("register", {body: {symbol: call_sign, faction}});
}
