import * as m_agent from "../agent.mjs";
import * as m_list from "../list.mjs";
import * as m_popup from "../popup.mjs";
import * as m_text_button_box from "../text_button_box.mjs";

const k_agent_list_id = "agent_list";
const k_agent_list_empty_string = "No Agents Found";

export function init() {
  m_text_button_box.connect_handler("add_agent_tbb", add_agent);
  m_text_button_box.connect_handler("create_agent_tbb", create_agent);

  refresh_list();
}

async function add_agent(box) {
  await m_popup.show(
    "Unimplemented Error",
    "Oops, I haven't implemented agent adding functionality yet",
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
    "Oops, I haven't implemented agent creation functionality yet",
    {
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
      button_activated_by_enter_key: m_popup.e_button.ok,
    }
  );
}

function refresh_list() {
  let available_agents = m_agent.get_available();
  let list_el;
  if (available_agents.length == 0) {
    list_el = document.createElement("span");
    list_el.classList.add("italic");
    list_el.textContent = k_agent_list_empty_string;
  } else {
    let list_items = [];
    for (const id of available_agents) {
      let agent_data = m_agent.get_cached_agent_data(id);
      list_items.push([id, agent_data.call_sign]);
    }
    list_el = m_list.create_selectable(
      list_items,
      select_agent,
      {delete_handler: remove_agent}
    );
  }
  let old_list_el = document.getElementById(k_agent_list_id);
  list_el.id = k_agent_list_id;
  old_list_el.replaceWith(list_el);
}

async function select_agent(clicked) {
  let call_sign = m_agent.get_cached_agent_data(clicked.id).call_sign;
  await m_popup.show(
    "Unimplemented Error",
    `Oops, I haven't implemented selection functionality yet, but you clicked: ${call_sign}`,
    {
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
      button_activated_by_enter_key: m_popup.e_button.ok,
    }
  );
}

async function remove_agent(clicked) {
  let call_sign = m_agent.get_cached_agent_data(clicked.id).call_sign;
  await m_popup.show(
    "Unimplemented Error",
    `Oops, I haven't implemented removal functionality yet, but you clicked: ${call_sign}`,
    {
      buttons: [m_popup.e_button.ok],
      allow_non_button_close: true,
      button_activated_by_enter_key: m_popup.e_button.ok,
    }
  );
}
