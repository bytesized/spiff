import * as m_error from "../error.mjs";
import * as m_popup from "../popup.mjs";
import * as m_progress from "../progress.mjs";
import * as m_server from "../server.mjs";
import * as m_server_events from "../server_events.mjs";

async function show_chart_loading_error(progress_el, message) {
  m_progress.set_error(progress_el);
  await m_popup.show({
    title: "Star Chart Loading Error",
    message,
    buttons: [m_popup.e_button.ok],
    allow_non_button_close: true,
    button_activated_by_enter_key: m_popup.e_button.ok,
  });
}

export async function init({page_el, progress_el, reinit}) {
  let progress_updated = false;
  let end_promise_fn;
  const promise_loading_complete = new Promise(resolve => {
    end_promise_fn = resolve;

    const error_listener = async error => {
      await show_chart_loading_error(progress_el, error.message);
    };

    m_server_events.add_listener(
      m_server_events.e_event_type.star_chart_load_error,
      error_listener
    );

    const progress_listener = status => {
      progress_updated = true;
      m_progress.update(progress_el, status.pages_loaded / status.total_pages_needed);
      if (status.pages_loaded == status.total_pages_needed) {
        end_promise_fn();
      }
    };

    m_server_events.add_listener(
      m_server_events.e_event_type.star_chart_load_progress,
      progress_listener
    );

    end_promise_fn = () => {
      m_server_events.remove_listener(
        m_server_events.e_event_type.star_chart_load_error,
        error_listener
      );
      m_server_events.remove_listener(
        m_server_events.e_event_type.star_chart_load_progress,
        progress_listener
      );

      resolve();
    };
  });

  const response = await m_server.star_chart.status();
  let system_loading_complete = false;
  let initialized = false;
  if (!response.success) {
    // Don't wait for popup to be shown/hidden
    m_error.show_server_failure_popup(response);
  } else if ("error_message" in response.result) {
    // Don't wait for popup to be shown/hidden
    show_chart_loading_error(progress_el, response.result.error_message);
  } else if (response.result.initialized) {
    initialized = true;
    system_loading_complete = response.result.pages_loaded == response.result.total_pages_needed;
  }

  if (system_loading_complete) {
    m_progress.update(progress_el, 1);
    end_promise_fn();
    return;
  }

  if (initialized && !progress_updated) {
    m_progress.update(
      progress_el,
      response.result.pages_loaded / response.result.total_pages_needed
    );
  }

  return promise_loading_complete;
}
