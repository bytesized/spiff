import * as m_agent from "../agent.mjs";
import * as m_storage from "../storage.mjs";

const k_no_agent_selected_message = "<no agent selected>";

export async function init() {
  await m_agent.init();

  m_agent.k_current.call_sign.add_change_listener(
    m_storage.change_el_text_callback("agent_page_call_sign", k_no_agent_selected_message),
    {run_immediately: true}
  );
  m_agent.k_current.headquarters.add_change_listener(
    m_storage.change_el_text_callback("agent_page_headquarters", k_no_agent_selected_message),
    {run_immediately: true}
  );
  m_agent.k_current.starting_faction.add_change_listener(
    m_storage.change_el_text_callback("agent_page_start_faction", k_no_agent_selected_message),
    {run_immediately: true}
  );
  m_agent.k_current.credits.add_change_listener(
    m_storage.change_el_text_callback("agent_page_credits", k_no_agent_selected_message),
    {run_immediately: true}
  );
}
