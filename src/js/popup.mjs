const k_show_popup_class = "popup_visible";
const k_popup_button_box_class = "popup_button_box";
const k_popup_button_box_spacer_class = "popup_button_box_spacer";
const k_popup_overlay_id = "under_popup_overlay";

// Allows us to serialize popups so we don't try to show two at once.
let g_popup_queue = Promise.resolve();

export const k_closed_by_overlay = "popup_closed_by_overlay";
let g_overlay_handler = null;

export const k_closed_by_escape_key = "popup_closed_by_escape_key";
let g_document_keydown_handler = null;

export const e_button = {
  close: "close_button",
  ok: "ok_button",
  yes: "yes_button",
  no: "no_button",
};

const k_button_properties = {
  [e_button.close]: {
    text: "Close",
  },
  [e_button.ok]: {
    text: "Ok",
  },
  [e_button.yes]: {
    text: "Yes",
  },
  [e_button.no]: {
    text: "No",
  },
};

export async function show(
  {
    title,
    message,
    readonly_textarea,
    buttons,
    allow_non_button_close,
    button_activated_by_enter_key
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
        hide();
        resolve(button);
      });
      button_box.appendChild(button_el);
      first = false;
    }

    let overlay = document.getElementById(k_popup_overlay_id);
    if (allow_non_button_close) {
      g_overlay_handler = event => {
        event = event || windows.event;
        if (event.target == overlay) {
          hide();
          resolve(k_closed_by_overlay);
          event.stopPropagation();
        }
      };
      overlay.addEventListener("click", g_overlay_handler);
    }

    if (allow_non_button_close || button_activated_by_enter_key) {
      g_document_keydown_handler = event => {
        event = event || windows.event;
        if (event.key == "Escape" && allow_non_button_close) {
          hide();
          resolve(k_closed_by_escape_key);
          event.stopPropagation();
        } else if (event.key == "Enter" && button_activated_by_enter_key) {
          hide();
          resolve(button_activated_by_enter_key);
          event.stopPropagation();
        }
      };
      document.addEventListener("keydown", g_document_keydown_handler);
    }

    let popup = document.getElementById("popup");
    popup.replaceChildren(...popup_elements);
    overlay.classList.add(k_show_popup_class);
    document.activeElement.blur();
  }));
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
