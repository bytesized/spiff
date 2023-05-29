import * as m_agent from "../agent.mjs";

const k_call_sign_display_id = "agent_page_call_sign";
const k_no_agent_selected_message = "<no agent selected>";

export function init() {
  m_agent.k_current.call_sign.add_change_listener(new_call_sign => {
    let el = document.getElementById(k_call_sign_display_id);
    if (new_call_sign == null) {
      el.textContent = k_no_agent_selected_message;
    } else {
      el.textContent = new_call_sign;
    }
  }, {run_immediately: true});
}
