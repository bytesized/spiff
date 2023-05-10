const k_hide_popup_class = "popup_hidden";
const k_popup_title_class = "popup_title";
const k_popup_message_class = "popup_message";
const k_popup_button_box_class = "popup_button_box";
const k_popup_button_class = "popup_button";
const k_popup_button_box_spacer_class = "popup_button_box_spacer"

export const k_closed_by_overlay = "popup_closed_by_overlay";
let g_overlay_handler = null;

export function show_raw(...elements) {
  let popup = document.getElementById("popup");

  popup.replaceChildren(...elements);
  document.body.classList.remove(k_hide_popup_class);
}

export function hide() {
  let popup = document.getElementById("popup");

  if (g_overlay_handler) {
    let overlay = document.getElementById("popup_container");
    overlay.removeEventListener("click", g_overlay_handler);
    g_overlay_handler = null;
  }
  document.body.classList.add(k_hide_popup_class);
  popup.replaceChildren();
}

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

export async function show(title, message, {buttons, allow_non_button_close} = {}) {
  return new Promise(resolve => {
    let title_el = document.createElement("h1");
    title_el.classList.add(k_popup_title_class);
    title_el.textContent = title;

    let message_el = document.createElement("p");
    message_el.classList.add(k_popup_message_class);
    message_el.textContent = message;

    let button_box = document.createElement("div");
    button_box.classList.add(k_popup_button_box_class);

    if (!buttons || !buttons.length) {
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
      button_el.classList.add(k_popup_button_class);
      button_el.textContent = k_button_properties[button].text;
      button_el.addEventListener("click", () => {
        hide();
        resolve(button);
      });
      button_box.appendChild(button_el);
      first = false;
    }

    if (allow_non_button_close) {
      let overlay = document.getElementById("popup_container");
      g_overlay_handler = () => {
        hide();
        resolve(k_closed_by_overlay);
      };
      overlay.addEventListener("click", g_overlay_handler);
    }

    show_raw(title_el, message_el, button_box);
  });
}
