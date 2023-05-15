import * as m_popup from "./popup.mjs";

export async function show_api_failure_popup(response) {
  await m_popup.show({
    title: "API Error",
    message: response.error_message,
    buttons: [m_popup.e_button.ok],
    allow_non_button_close: true,
    button_activated_by_enter_key: m_popup.e_button.ok,
  });
}
