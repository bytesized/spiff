import * as m_popup from "../popup.mjs";
import * as m_text_button_box from "../text_button_box.mjs";

export function init() {
  m_text_button_box.connect_handler("add_agent_tbb", add_agent);
  m_text_button_box.connect_handler("create_agent_tbb", create_agent);
}

async function add_agent(box) {
  await m_popup.show(
    "Unimplemented Error",
    "Oops, I haven't implemented this functionality yet",
    {
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
      button_activated_by_enter_key: m_popup.e_button.ok,
    }
  );
}

async function create_agent(box) {
  await m_popup.show(
    "Unimplemented Error",
    "Oops, I haven't implemented this functionality yet",
    {
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
      button_activated_by_enter_key: m_popup.e_button.ok,
    }
  );
}
