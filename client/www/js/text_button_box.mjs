import * as m_busy_spinner from "./busy_spinner.mjs";
import * as m_log from "./log.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.debug, "text_button_box");

const k_box_class = "text_button_box";
const k_box_selector = `.${k_box_class}`;

export function init() {
  for (const box of document.getElementsByClassName(k_box_class)) {
    try {
      let button = get_button(box);
      let inputs = get_inputs(box);
      for (const input of inputs) {
        input.addEventListener("keydown", event => {
          event = event || window.event;
          if (event.key == "Enter") {
            button.click();
            event.stopPropagation();
          }
        });
      }
    } catch (ex) {
      k_log.error(ex);
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

function get_inputs(box_el) {
  let inputs = box_el.getElementsByTagName("input");
  if (inputs.length == 0) {
    throw new Error("text_button_box missing its input", box_el);
  }
  return inputs;
}

export function is_busy(box_el) {
  return m_busy_spinner.has_busy_spinner(box_el);
}

export function set_busy(box_el) {
  if (is_busy(box_el)) {
    throw new Error("Attempted to set already busy box to busy");
  }

  let button = get_button(box_el);
  button.disabled = true;
  for (const input of get_inputs(box_el)) {
    input.disabled = true;
  }

  box_el.appendChild(m_busy_spinner.create({with_overlay: true}));
}

export function clear_busy(box_el) {
  if (!is_busy(box_el)) {
    throw new Error("Attempted to clear busy status of non-busy box");
  }

  let button = get_button(box_el);
  button.disabled = false;
  for (const input of get_inputs(box_el)) {
    input.disabled = false;
  }

  m_busy_spinner.remove_overlay(box_el);
}

/**
 * When the button associated with the passed box is clicked, the passed handler is called. The
 * argument that it is passed will be an object with these properties:
 *  element
 *    The button box itself
 *  input
 *    The `<input>` in the button box. If the button box contains multiple inputs, this will
 *    contain an arbitrary one.
 *  button
 *    The `<button>` in the button box.
 */
export function connect_handler(box_id, handler) {
  let box = document.getElementById(box_id);
  let button = get_button(box);
  let input = get_inputs(box)[0];
  button.addEventListener("click", async event => {
    event = event || window.event;
    event.stopPropagation();
    set_busy(box);
    await handler({element: box, input, button});
    clear_busy(box);
  });
}
