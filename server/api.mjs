import * as m_api_request from "./api_request.mjs";

export async function get_agent_details(auth_token) {
  return m_api_request.dispatch("my/agent", {auth_token});
}
