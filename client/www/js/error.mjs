import * as m_popup from "./popup.mjs";

export async function show_api_failure_popup(response) {
  let title = "API Error";
  let message = response.error_message;
  await m_popup.show({
    title,
    message,
    buttons: [m_popup.e_button.ok],
    allow_non_button_close: true,
    button_activated_by_enter_key: m_popup.e_button.ok,
  });
}

export async function show_server_failure_popup(response) {
  let title = "Server Error";
  let message = response.error_message;
  await m_popup.show({
    title,
    message,
    buttons: [m_popup.e_button.ok],
    allow_non_button_close: true,
    button_activated_by_enter_key: m_popup.e_button.ok,
  });
}
