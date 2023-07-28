const k_show_popup_class = "popup_visible";
const k_popup_max_size_class = "max_size";
const k_popup_button_box_class = "popup_button_box";
const k_popup_button_box_spacer_class = "popup_button_box_spacer";
const k_popup_overlay_id = "under_popup_overlay";

// This Promise will allow us to serialize popups so we don't try to show two at once.
let g_popup_queue = null;

export const e_close_reason = Object.freeze({
  overlay: "e_close_reason::overlay",
  escape_key: "e_close_reason::escape_key",
  button: "e_close_reason::button",
  fn: "e_close_reason::fn",
});

let g_overlay_handler = null;
let g_document_keydown_handler = null;

export const e_button = Object.freeze({
  close: "e_button::close",
  ok: "e_button::ok",
  yes: "e_button::yes",
  no: "e_button::no",
});

const k_button_properties = Object.freeze({
  [e_button.close]: Object.freeze({
    text: "Close",
  }),
  [e_button.ok]: Object.freeze({
    text: "Ok",
  }),
  [e_button.yes]: Object.freeze({
    text: "Yes",
  }),
  [e_button.no]: Object.freeze({
    text: "No",
  }),
});

// Unlike the `init` functions in most other modules, this one ought to be called before the
// `DOMContentLoaded` event.
export function init() {
  g_popup_queue = new Promise(resolve => window.addEventListener("DOMContentLoaded", resolve));
}

/**
 * @param allow_non_button_close
 *        Allows the popup to be closed via an escape key press or by clicking on the overlay
 *        behind the popup.
 * @param button_activated_by_enter_key
 *        If specified and the enter key is pressed while the popup is open, the popup will close
 *        and `show` will return with `reason = e_close_reason.button` and `button` equal to the
 *        value passed as this argument.
 * @param fn
 *        A function that will be called just after the popup is shown. It will be passed a single
 *        argument that will also be a function, `close`. If `close` is called it will cause the
 *        popup to close and `show` to return with `reason == e_close_reason.fn`. A single argument
 *        can be passed to `close` which will be used to set `value` in the object returned by
 *        `show`.
 * @param max_size
 *        If set to `true`, the popup will take up the entire screen.
 *
 * Returns an object with these properties:
 *  reason
 *    A value of `e_close_reason` describing what caused the popup to close
 *  button
 *    Present if `reason == e_close_reason.button`. Will be a value of `e_button` indicating which
 *    button was pressed to close the popup.
 *  value
 *    Present if `reason == e_close_reason.fn`. Will be the value passed to `fn`'s `close` argument
 *    when it was called.
 */
export async function show(
  {
    title,
    message,
    readonly_textarea,
    element,
    buttons,
    allow_non_button_close,
    button_activated_by_enter_key,
    fn,
    max_size,
  } = {}
) {
  g_popup_queue = g_popup_queue.then(() => {}, () => {}).then(() => new Promise(resolve => {
    let popup_elements = [];

    if (title) {
      let title_el = document.createElement("h1");
      title_el.textContent = title;
      popup_elements.push(title_el);
    }

    if (message) {
      let message_el = document.createElement("p");
      message_el.textContent = message;
      popup_elements.push(message_el);
    }

    if (readonly_textarea) {
      let textarea_el = document.createElement("textarea");
      textarea_el.setAttribute("readonly", "");
      textarea_el.textContent = readonly_textarea;
      popup_elements.push(textarea_el);
    }

    if (element) {
      popup_elements.push(element);
    }

    let button_box = document.createElement("div");
    button_box.classList.add(k_popup_button_box_class);
    popup_elements.push(button_box);

    if (!buttons) {
      buttons = [e_button.close];
    }

    let first = true;
    for (const button of buttons) {
      if (!first || buttons.length == 1) {
        let spacer = document.createElement("span");
        spacer.classList.add(k_popup_button_box_spacer_class);
        button_box.appendChild(spacer);
      }
      let button_el = document.createElement("button");
      button_el.textContent = k_button_properties[button].text;
      button_el.addEventListener("click", () => {
        resolve({reason: e_close_reason.button, button});
      });
      button_box.appendChild(button_el);
      first = false;
    }

    let overlay = document.getElementById(k_popup_overlay_id);
    if (allow_non_button_close) {
      g_overlay_handler = event => {
        event = event || windows.event;
        if (event.target == overlay) {
          event.stopPropagation();
          resolve({reason: e_close_reason.overlay});
        }
      };
      overlay.addEventListener("click", g_overlay_handler);
    }

    if (allow_non_button_close || button_activated_by_enter_key) {
      g_document_keydown_handler = event => {
        event = event || windows.event;
        if (event.key == "Escape" && allow_non_button_close) {
          event.stopPropagation();
          resolve({reason: e_close_reason.escape_key});
        } else if (event.key == "Enter" && button_activated_by_enter_key) {
          event.stopPropagation();
          resolve({reason: e_close_reason.button, button: button_activated_by_enter_key});
        }
      };
      document.addEventListener("keydown", g_document_keydown_handler);
    }

    const popup = document.getElementById("popup");

    if (max_size) {
      popup.classList.add(k_popup_max_size_class);
    } else {
      popup.classList.remove(k_popup_max_size_class);
    }

    popup.replaceChildren(...popup_elements);
    overlay.classList.add(k_show_popup_class);
    document.activeElement.blur();

    if (fn) {
      const fn_close_arg = value => resolve({reason: e_close_reason.fn, value});
      fn(fn_close_arg);
    }
  })).then(rv => {
    hide();
    return rv;
  });
  return g_popup_queue;
}

function hide() {
  let popup = document.getElementById("popup");
  let overlay = document.getElementById(k_popup_overlay_id);

  if (g_overlay_handler) {
    let overlay = document.getElementById(k_popup_overlay_id);
    overlay.removeEventListener("click", g_overlay_handler);
    g_overlay_handler = null;
  }
  if (g_document_keydown_handler) {
    document.removeEventListener("keydown", g_document_keydown_handler);
    g_document_keydown_handler = null;
  }
  overlay.classList.remove(k_show_popup_class);
  popup.replaceChildren();
}

init();
