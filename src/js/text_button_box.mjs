const k_box_class = "text_button_box";

export function init() {
  for (const box of document.getElementsByClassName(k_box_class)) {
    let button = box.getElementsByTagName("button")[0];
    if (!button) {
      console.warn("Text button box is missing its button", box);
      continue;
    }
    let input = box.getElementsByTagName("input")[0];
    if (!input) {
      console.warn("Text button box is missing its input", box);
      continue;
    }
    input.addEventListener("keydown", event => {
      event = event || window.event;
      if (event.keyCode == 13) {
        button.click();
      }
    });
  }
}
