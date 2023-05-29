import * as m_agent from "./agent.mjs";
import * as m_agent_page from "./page/agent.mjs";
import * as m_settings_page from "./page/settings.mjs";

const k_page_class = "page";
const k_active_page_class = "active_page";
const k_nav_button_disabled_class = "disabled";

const e_page = {
  agent: "e_page::agent",
  star_chart: "e_page::star_chart",
  ships: "e_page::ships",
  settings: "e_page::settings",
};

const k_pages = Object.values(e_page);

const k_page_button_id = {
  [e_page.agent]: "agent_icon",
  [e_page.star_chart]: "star_chart_icon",
  [e_page.ships]: "ship_icon",
  [e_page.settings]: "settings_icon",
};

const k_page_init_fn = {
  [e_page.settings]: m_settings_page.init,
  [e_page.agent]: m_agent_page.init,
};

const k_page_disabled_if_no_agent_selected = {
  [e_page.agent]: true,
  [e_page.star_chart]: true,
  [e_page.ships]: true,
  [e_page.settings]: false,
};

const k_page_el_id = {
  [e_page.agent]: "agent_page",
  [e_page.star_chart]: "star_chart_page",
  [e_page.ships]: "ships_page",
  [e_page.settings]: "settings_page",
};

const g_button_listener = {};

export async function init() {
  let page_init_fns = [];
  for (const page of k_pages) {
    if (page in k_page_init_fn) {
      page_init_fns.push(k_page_init_fn[page]());
    }
  }

  for (const page of k_pages) {
    if (!k_page_disabled_if_no_agent_selected[page]) {
      let button = document.getElementById(k_page_button_id[page]);
      let callback = show_page.bind(null, page);
      g_button_listener[page] = callback;
      button.addEventListener("click", callback);
    }
  }

  m_agent.k_current.id.add_change_listener(current_agent => {
    if (current_agent == null) {
      disable_navigation();
    } else {
      enable_navigation();
    }
  }, {run_immediately: true});

  return Promise.allSettled(page_init_fns);
}

function enable_navigation() {
  for (const page of k_pages) {
    let button = document.getElementById(k_page_button_id[page]);
    button.classList.remove(k_nav_button_disabled_class);
    if (!(page in g_button_listener)) {
      let callback = show_page.bind(null, page);
      g_button_listener[page] = callback;
      button.addEventListener("click", callback);
    }
  }
}

function disable_navigation() {
  for (const page of k_pages) {
    if (!k_page_disabled_if_no_agent_selected[page]) {
      continue;
    }
    let button = document.getElementById(k_page_button_id[page]);
    button.classList.add(k_nav_button_disabled_class);
    if (page in g_button_listener) {
      button.removeEventListener("click", g_button_listener[page]);
      delete g_button_listener[page];
    }
  }
}

function show_page(page) {
  for (const active_page of document.querySelectorAll(`.${k_page_class}.${k_active_page_class}`)) {
    active_page.classList.remove(k_active_page_class);
  }
  let page_el = document.getElementById(k_page_el_id[page]);
  page_el.classList.add(k_active_page_class);
}
