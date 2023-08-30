import * as m_agent from "../agent.mjs";
import * as m_error from "../error.mjs";
import * as m_popup from "../popup.mjs";
import * as m_progress from "../progress.mjs";
import * as m_server from "../server.mjs";
import * as m_server_events from "../server_events.mjs";
import * as m_star_chart from "../star_chart.mjs";
import * as m_storage from "../storage.mjs";

let g_star_chart;
let g_page_active = false;

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
  if (reinit) {
    // This should be unnecessary because we only re-initialize on a server reset and star charts
    // remove themselves from the DOM on server reset. But it may be possible that it could still
    // be in the process of deconstructing. So if there is an old instance, wait for it to finish.
    if (g_star_chart) {
      g_star_chart.cancel();
      await g_star_chart.until_close();
      g_star_chart = null;
    }
  } else {
    await m_agent.init();
    m_agent.agents.add_change_listener(new m_storage.ChangeListener({
      selected_only: true,
      properties: ["id"],
      callback: event => {
        if (event.selection_set && g_star_chart) {
          g_star_chart.auth_token = event.entry.auth_token;
          g_star_chart.set_location(m_star_chart.e_location_type.waypoint,
                                    event.entry.headquarters,
                                    m_star_chart.e_location_view_type.centered_on);
        }
      },
    }));
  }

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

    end_promise_fn = async () => {
      m_server_events.remove_listener(
        m_server_events.e_event_type.star_chart_load_error,
        error_listener
      );
      m_server_events.remove_listener(
        m_server_events.e_event_type.star_chart_load_progress,
        progress_listener
      );

      const selected_agent = await m_agent.agents.get_selection();

      let activated = m_star_chart.e_activation.inactive;
      let auth_token = null;
      let initial_location_type = null;
      let initial_location = null;
      let initial_location_view_type = null;
      if (selected_agent) {
        if (g_page_active) {
          activated = m_star_chart.e_activation.active;
        }
        auth_token = selected_agent.auth_token;
        initial_location_type = m_star_chart.e_location_type.waypoint;
        initial_location = selected_agent.headquarters;
        initial_location_view_type = m_star_chart.e_location_view_type.centered_on;
      }

      g_star_chart = new m_star_chart.StarChart(
        m_star_chart.e_selection_type.view_only,
        activated,
        auth_token,
        initial_location_type, initial_location, initial_location_view_type
      );
      page_el.append(g_star_chart.element);

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

export function on_page_activate() {
  g_page_active = true;
  if (g_star_chart) {
    g_star_chart.activate();
  }
}

export function on_page_deactivate() {
  g_page_active = false;
  if (g_star_chart) {
    g_star_chart.deactivate();
  }
}
