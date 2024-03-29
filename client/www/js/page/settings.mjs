import * as m_agent from "../agent.mjs";
import * as m_agent_shared from "../shared/agent.mjs";
import * as m_error from "../error.mjs";
import * as m_list from "../list.mjs";
import * as m_popup from "../popup.mjs";
import * as m_radio from "../radio.mjs";
import * as m_server from "../server.mjs";
import * as m_storage from "../storage.mjs";
import * as m_text_button_box from "../text_button_box.mjs";

const k_agent_list_id = "agent_list";
const k_create_agent_call_sign_input_id = "create_agent_call_sign";
const k_create_agent_faction_input_id = "create_agent_faction";
const k_agent_list_empty_string = "No Agents Found";
const k_agent_empty_list_class = "agent_list_empty";

const k_invalid_agent_name_error_code = 422;

const k_server_reset_behavior = Object.freeze({
  [m_agent_shared.e_server_reset_behavior.ignore]: "Do Nothing",
  [m_agent_shared.e_server_reset_behavior.remove]: "Remove Agents",
  [m_agent_shared.e_server_reset_behavior.recreate]: "Attempt to Re-Create Agents",
});

export async function init({page_el}) {
  await m_agent.init();

  m_text_button_box.connect_handler("add_agent_tbb", add_agent);
  m_text_button_box.connect_handler("create_agent_tbb", create_agent);

  m_agent.agents.add_change_listener(new m_storage.ChangeListener({
    add: true,
    callback: event => {
      if (list_length() == 0) {
        const list_items = [[event.entry.id, m_agent.format_call_sign(event.entry.call_sign)]];
        const options = {delete_handler: remove_agent};
        const list_el = m_list.create_selectable(list_items, select_agent, options);
        replace_list(list_el);
      } else {
        const list_el = document.getElementById(k_agent_list_id);
        m_list.add_item(list_el, event.entry.id, [m_agent.format_call_sign(event.entry.call_sign)],
                        select_agent, {delete_handler: remove_agent});
      }
    },
  }));

  m_agent.agents.add_change_listener(new m_storage.ChangeListener({
    properties: ["call_sign"],
    callback: event => {
      const list_el = document.getElementById(k_agent_list_id);
      const item_el = m_list.get_item(list_el, event.entry.id);
      m_list.set_item_contents(item_el, m_agent.format_call_sign(event.entry.call_sign));
    },
  }));

  m_agent.agents.add_change_listener(new m_storage.ChangeListener({
    remove: true,
    callback: event => {
      if (event.type == m_storage.e_change_type.entries_cleared || list_length() <= 1) {
        replace_list(make_empty_list_standin());
      } else {
        m_list.remove_item(document.getElementById(k_agent_list_id), event.entry.id);
      }
    },
  }));

  m_agent.agents.add_change_listener(new m_storage.ChangeListener({
    selected_only: true,
    properties: ["id"],
    callback: event => {
      const list_el = document.getElementById(k_agent_list_id);
      if (event.selection_set) {
        let item = m_list.get_item(list_el, event.entry.id);
        m_list.select_item(item);
      } else {
        m_list.clear_selection(list_el);
      }
    },
  }));

  const agents = await m_agent.agents.get_all();
  const selected_agent = await m_agent.agents.get_selection_key();
  let list_el;
  if (agents.length < 1) {
    list_el = make_empty_list_standin();
  } else {
    let list_items = [];
    for (const agent of agents) {
      list_items.push([agent.id, m_agent.format_call_sign(agent.call_sign)]);
    }
    let options = {delete_handler: remove_agent};
    if (selected_agent != null) {
      options.selected_id = selected_agent;
    }
    list_el = m_list.create_selectable(list_items, select_agent, options);
  }
  replace_list(list_el);

  const response = await m_server.agent.get_server_reset_behavior();
  if (!response.success) {
    throw new Error(`Failed to get agent server reset behavior: ${response.error_message}`);
  }
  const radio_items = [];
  for (const id in k_server_reset_behavior) {
    radio_items.push([id, k_server_reset_behavior[id]]);
  }
  const radio = m_radio.create(
    radio_items,
    server_reset_behavior_change,
    {horizontal: true, selected_id: response.result.server_reset_behavior}
  );
  const loading_el = document.getElementById("server_reset_loading");
  loading_el.parentNode.replaceChild(radio, loading_el);
}

function list_length() {
  const list_el = document.getElementById(k_agent_list_id);
  if (list_el.classList.contains(k_agent_empty_list_class)) {
    return 0;
  }
  return m_list.item_count(list_el);
}

function make_empty_list_standin() {
  let list_el = document.createElement("span");
  list_el.classList.add("italic", k_agent_empty_list_class);
  list_el.textContent = k_agent_list_empty_string;
  return list_el;
}

function replace_list(new_list_el) {
  let old_list_el = document.getElementById(k_agent_list_id);
  new_list_el.id = k_agent_list_id;
  old_list_el.replaceWith(new_list_el);
}

async function add_agent(box) {
  let auth_token = box.input.value;
  let response = await m_agent.add(auth_token);
  if (!response.success) {
    return m_error.show_api_failure_popup(response);
  }
  box.input.value = "";
}

async function create_agent(box) {
  let call_sign = document.getElementById(k_create_agent_call_sign_input_id).value;
  let faction = document.getElementById(k_create_agent_faction_input_id).value;
  let response = await m_agent.register(call_sign, faction);
  if (!response.success) {
    if (response.payload?.error?.code == k_invalid_agent_name_error_code) {
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
  box.input.value = "";
}

async function select_agent(clicked) {
  m_list.set_busy(clicked.list);
  let agent_info_response = await m_agent.set_selected(clicked.id);
  m_list.clear_busy(clicked.list);
  if (!agent_info_response.success) {
    await m_error.show_api_failure_popup(agent_info_response);
  }
}

async function remove_agent(clicked) {
  m_list.set_busy(clicked.list);
  const agent = await m_agent.agents.get(clicked.id);
  const close = await m_popup.show({
    title: "Remove Agent?",
    message:
      `Are you sure you want to remove agent "${m_agent.format_call_sign(agent.call_sign)}"? If ` +
      `you haven't already backed up your agent's token, it may be impossible to recover access ` +
      `to this agent.` ,
    buttons: [m_popup.e_button.yes, m_popup.e_button.no],
    allow_non_button_close: true,
  });
  if (close.reason == m_popup.e_close_reason.button && close.button == m_popup.e_button.yes) {
    const response = await m_agent.remove(clicked.id);
    if (!response.success) {
      await m_error.show_api_failure_popup(response);
    }
  }
  m_list.clear_busy(clicked.list);
}

async function server_reset_behavior_change(clicked) {
  if (m_radio.is_busy(clicked.radio_container)) {
    // This must have been the selection being changed back as the result of a server failure.
    // Just exit early.
    return;
  }
  m_radio.set_busy(clicked.radio_container);
  const response = await m_server.agent.set_server_reset_behavior(clicked.id);
  if (!response.success) {
    await m_error.show_server_failure_popup(response);
    m_radio.select(clicked.radio_container, clicked.prev_id);
  }
  m_radio.clear_busy(clicked.radio_container);
}
