const k_spinner_class = "busy_spinner";

export function create() {
  let el = document.createElement("div");
  el.classList.add(k_spinner_class);
  return el;
}