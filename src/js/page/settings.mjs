import * as m_agent from "../agent.mjs";
import * as m_api from "../api.mjs";
import * as m_error from "../error.mjs";
import * as m_list from "../list.mjs";
import * as m_popup from "../popup.mjs";
import * as m_text_button_box from "../text_button_box.mjs";

const k_agent_list_id = "agent_list";
const k_create_agent_call_sign_input_id = "create_agent_call_sign";
const k_create_agent_faction_input_id = "create_agent_faction";
const k_agent_list_empty_string = "No Agents Found";

const k_invalid_agent_name = 422;

let g_agent_callbacks = {};

export async function init() {
  m_text_button_box.connect_handler("add_agent_tbb", add_agent);
  m_text_button_box.connect_handler("create_agent_tbb", create_agent);

  let default_agent_id = m_agent.k_current.id.get();
  if (default_agent_id != null) {
    let refresh_response = await refresh_agent(default_agent_id);
    if (!refresh_response.success) {
      m_agent.k_current.id.unset();
    }
  }

  m_agent.k_available.ids.add_change_listener(available_agents => {
    for (const id in g_agent_callbacks) {
      m_agent.k_available.call_sign.remove_change_listener(id, g_agent_callbacks[id]);
    }
    g_agent_callbacks = {};

    let list_el;
    if (available_agents.length == 0) {
      list_el = document.createElement("span");
      list_el.classList.add("italic");
      list_el.textContent = k_agent_list_empty_string;
    } else {
      let list_items = [];
      for (const id of available_agents) {
        let call_sign = m_agent.k_available.call_sign.get(id);
        list_items.push([id, format_call_sign(call_sign)]);
      }
      let options = {delete_handler: remove_agent};
      let selected = m_agent.k_current.id.get();
      if (selected != null) {
        options.selected_id = selected;
      }
      list_el = m_list.create_selectable(list_items, select_agent, options);

      for (const id of available_agents) {
        let callback = new_call_sign => {
          let item = m_list.get_item(list_el, id);
          m_list.set_item_contents(item, format_call_sign(new_call_sign));
        };
        g_agent_callbacks[id] = callback;
        m_agent.k_available.call_sign.add_change_listener(id, callback);
      }
    }
    let old_list_el = document.getElementById(k_agent_list_id);
    list_el.id = k_agent_list_id;
    old_list_el.replaceWith(list_el);
  }, {run_immediately: true});

  m_agent.k_current.id.add_change_listener(current_agent => {
    let list = document.getElementById(k_agent_list_id);
    if (current_agent == null) {
      m_list.clear_selection(list);
    } else {
      let item = m_list.get_item(list, current_agent);
      m_list.select_item(item);
    }
  });
}

function format_call_sign(call_sign) {
  return call_sign.toLowerCase();
}

async function add_agent(box) {
  let token = box.input.value;
  let response = await m_api.get_agent_details(token);
  if (!response.success) {
    return m_error.show_api_failure_popup(response);
  }
  let id = m_agent.add(token, response.payload.data.symbol);
  box.input.value = "";
}

async function create_agent(box) {
  let call_sign = document.getElementById(k_create_agent_call_sign_input_id).value;
  let faction = document.getElementById(k_create_agent_faction_input_id).value;
  let response = await m_api.register_agent(call_sign, faction);
  if (!response.success) {
    if (response.payload?.error?.code == k_invalid_agent_name) {
      return m_popup.show({
        title: "Error: Invalid Agent Name",
        message: response.payload.error.data.symbol[0],
        buttons: [m_popup.e_button.ok],
        allow_non_button_close: true,
        button_activated_by_enter_key: m_popup.e_button.ok,
      });
    } else {
      return m_error.show_api_failure_popup(response);
    }
  }
  m_agent.add(response.payload.data.token, response.payload.data.agent.symbol);
  box.input.value = "";
}

async function select_agent(clicked) {
  m_list.set_busy(clicked.list);
  m_agent.k_current.id.unset();

  let refresh_response = await refresh_agent(clicked.id);
  if (!refresh_response.success) {
    m_list.clear_busy(clicked.list);
    return m_error.show_api_failure_popup(refresh_response);
  }

  m_agent.k_current.id.set(clicked.id);
  m_list.clear_busy(clicked.list);
}

async function refresh_agent(agent_id) {
  let auth_token = m_agent.k_available.auth_token.get(agent_id);
  let response = await m_api.get_agent_details(auth_token);
  if (!response.success) {
    return response;
  }

  m_agent.k_available.call_sign.set(agent_id, response.payload.data.symbol);
  return response;
}

async function remove_agent(clicked) {
  let call_sign = m_agent.k_available.call_sign.get(clicked.id);
  let popup_button = await m_popup.show({
    title: "Remove Agent?",
    message:
      `Are you sure you want to remove agent "${call_sign.toLowerCase()}"? If you haven't ` +
      `already backed up your agent's token, it may be impossible to recover access to this ` +
      `agent.` ,
    buttons: [m_popup.e_button.yes, m_popup.e_button.no],
    allow_non_button_close: true,
  });
  if (popup_button != m_popup.e_button.yes) {
    return;
  }
  m_agent.remove(clicked.id);
}
