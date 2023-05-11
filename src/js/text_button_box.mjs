import * as m_busy_spinner from "./busy_spinner.mjs";

const k_box_class = "text_button_box";
const k_box_selector = `.${k_box_class}`;
const k_box_busy_overlay_class = "text_button_box_busy_overlay";

export function init() {
  for (const box of document.getElementsByClassName(k_box_class)) {
    try {
      let button = get_button(box);
      let input = get_input(box);
      input.addEventListener("keydown", event => {
        event = event || window.event;
        if (event.key == "Enter") {
          button.click();
          event.stopPropagation();
        }
      });
    } catch (ex) {
      console.error(ex);
    }
  }
}

export function get_box(child_el) {
  return child_el.closest(k_box_selector);
}

function get_button(box_el) {
  let button = box_el.getElementsByTagName("button")[0];
  if (!button) {
    throw new Error(`text_button_box '${box_el.id}' missing its button`);
  }
  return button;
}

function get_input(box_el) {
  let input = box_el.getElementsByTagName("input")[0];
  if (!input) {
    throw new Error("text_button_box missing its input", box_el);
  }
  return input;
}

export function is_busy(box_el) {
  return box_el.getElementsByClassName(k_box_busy_overlay_class).length > 0;
}

export function set_busy(box_el) {
  if (is_busy(box_el)) {
    throw new Error("Attempted to set already busy box to busy");
  }

  let button = get_button(box_el);
  let input = get_input(box_el);
  button.disabled = true;
  input.disabled = true;

  let overlay = document.createElement("div");
  overlay.classList.add(k_box_busy_overlay_class);
  let spinner = m_busy_spinner.create();
  overlay.appendChild(spinner);
  box_el.appendChild(overlay);
}

export function clear_busy(box_el) {
  if (!is_busy(box_el)) {
    throw new Error("Attempted to clear busy status of non-busy box");
  }

  let button = get_button(box_el);
  let input = get_input(box_el);

  button.disabled = false;
  input.disabled = false;

  for (const overlay of box_el.getElementsByClassName(k_box_busy_overlay_class)) {
    overlay.remove();
  }
}

export function connect_handler(box_id, handler) {
  let box = document.getElementById(box_id);
  let button = get_button(box);
  let input = get_input(box);
  button.addEventListener("click", async event => {
    event = event || window.event;
    event.stopPropagation();
    set_busy(box);
    await handler({element: box, input, button});
    clear_busy(box);
  });
}
