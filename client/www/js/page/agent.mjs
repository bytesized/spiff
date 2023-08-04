import * as m_agent from "../agent.mjs";
import * as m_popup from "../popup.mjs";
import * as m_storage from "../storage.mjs";

const k_no_agent_selected_message = "<no agent selected>";

export async function init({page_el}) {
  await m_agent.init();

  m_storage.sync_el_text_with_selection_property(m_agent.agents, k_no_agent_selected_message, {
    call_sign: ["agent_page_call_sign"],
    headquarters: ["agent_page_headquarters"],
    starting_faction: ["agent_page_start_faction"],
    credits: ["agent_page_credits"],
    auth_token: ["auth_token_cache"],
  });
  document.getElementById("auth_token_view_button").addEventListener("click", async event => {
    return m_popup.show({
      title: "Auth Token",
      readonly_textarea: document.getElementById("auth_token_cache").textContent,
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
    });
  });
}
