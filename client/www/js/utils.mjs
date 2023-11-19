export function create_el(el_type, {parent = null, classes = null, text = null} = {}) {
  const el = document.createElement(el_type);
  if (parent) {
    parent.append(el);
  }
  if (classes?.length) {
    el.classList.add(...classes);
  }
  if (text != null) {
    el.textContent = text;
  }
  return el;
};
