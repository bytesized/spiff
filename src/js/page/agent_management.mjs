import * as m_popup from "../popup.mjs";

export function init() {
  document.getElementById("new_agent_button").addEventListener("click", async () => {
    let token = document.getElementById("new_agent_input").value;
    await add_agent(token);
  });

  document.getElementById("create_agent_button").addEventListener("click", async () => {
    let call_sign = document.getElementById("create_agent_input").value;
    await create_agent(call_sign);
  });
}

async function add_agent(token) {
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

async function create_agent(call_sign) {
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
