const k_spinner_class = "busy_spinner";
const k_busy_overlay_class = "sub_spinner_overlay";

export function create({with_overlay} = {}) {
  let el = document.createElement("div");
  el.classList.add(k_spinner_class);
  if (with_overlay) {
    let overlay = document.createElement("div");
    overlay.classList.add(k_busy_overlay_class);
    overlay.append(el);
    el = overlay;
  }
  return el;
}

export function has_busy_spinner(el) {
  return el.getElementsByClassName(k_spinner_class).length > 0;
}

export function remove_overlay(el) {
  for (const overlay of el.getElementsByClassName(k_busy_overlay_class)) {
    overlay.remove();
  }
}
