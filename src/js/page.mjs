import * as m_agent from "./agent.mjs";
import * as m_agent_page from "./page/agent.mjs";
import * as m_progress from "./progress.mjs";
import * as m_settings_page from "./page/settings.mjs";

const k_page_class = "page";
const k_active_page_class = "active_page";
const k_nav_button_disabled_class = "disabled";
const k_active_page_selector = `.${k_page_class}.${k_active_page_class}`;

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
  [e_page.settings]: {fn: m_settings_page.init},
  [e_page.agent]: {fn: m_agent_page.init},
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
const g_inited_pages = [];
let g_page_module_init_done = false;

export async function init() {
  let init_promises = [];
  for (const page of k_pages) {
    if (page in k_page_init_fn) {
      init_promises.push(init_page(page));
    } else {
      g_inited_pages.push(page);
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

  init_promises.push((async () => {
    await m_agent.init();

    m_agent.k_current.id.add_change_listener(current_agent => {
      if (current_agent == null) {
        disable_navigation();
      } else {
        enable_navigation();
      }
    }, {run_immediately: true});

    g_page_module_init_done = true;
  })());

  return Promise.allSettled(init_promises);
}

async function init_page(page) {
  let args = [];
  let progress_el;
  if (k_page_init_fn[page].progress) {
    progress_el = m_progress.create({padding: "0.1rem"});
    let button = document.getElementById(k_page_button_id[page]);
    button.append(progress_el);
    args.push(progress_el);
  }
  await k_page_init_fn[page].fn(...args);
  if (progress_el) {
    progress_el.remove();
  }
  g_inited_pages.push(page);
  if (g_page_module_init_done && m_agent.k_current.id.is_set()) {
    enable_button(page);
  }
}

function enable_navigation() {
  for (const page of g_inited_pages) {
    enable_button(page);
  }
}

function enable_button(page) {
  let button = document.getElementById(k_page_button_id[page]);
  button.classList.remove(k_nav_button_disabled_class);
  if (!(page in g_button_listener)) {
    let callback = show_page.bind(null, page);
    g_button_listener[page] = callback;
    button.addEventListener("click", callback);
  }
}

function disable_navigation() {
  for (const page of k_pages) {
    if (!k_page_disabled_if_no_agent_selected[page]) {
      continue;
    }
    disable_button(page);
  }
}

function disable_button(page) {
  let button = document.getElementById(k_page_button_id[page]);
  button.classList.add(k_nav_button_disabled_class);
  if (page in g_button_listener) {
    button.removeEventListener("click", g_button_listener[page]);
    delete g_button_listener[page];
  }
}

function show_page(page) {
  for (const active_page of document.querySelectorAll(k_active_page_selector)) {
    active_page.classList.remove(k_active_page_class);
  }
  let page_el = document.getElementById(k_page_el_id[page]);
  page_el.classList.add(k_active_page_class);
}
