import * as m_busy_spinner from "./busy_spinner.mjs";

const k_list_container_class = "list_container";
const k_selectable_class = "selectable";
const k_content_class = "content";
const k_spacer_class = "spacer";
const k_trash_button_class = "trash";
const k_selected_item_class = "selected";
const k_item_id_attribute = "list_id";

/**
 * @param items
 *        An array describing the list items to be added to the created list. Each element in the
 *        array should be an array containing at least two items. The first should be a string
 *        representing the ID of the list item. The remaining can be any combination of text
 *        strings and DOM nodes that will be used as the contents of the corresponding list item
 *        element.
 * @param handler
 *        The callback function to be called when an item in the list is clicked. It will be passed
 *        a single argument that will be an object with these keys:
 *          list
 *            The list DOM element, which will be an `<ul>`.
 *          item
 *            The list item DOM element, which will be an `<li>`.
 *          id
 *            The ID from `items` that corresponds to the clicked list item.
 * @param delete_handler
 *        If passed, delete icons will be placed next to each list item and, when clicked, this
 *        handler will be invoked. The argument passed to it will be the same as the argument that
 *        would be passed to `handler`.
 * @param selected_id
 *        If passed, the item with this id will be selected. Otherwise, no item will initially be
 *        selected.
 * @return
 *        Technically this function returns a container with the list in it rather than the list
 *        itself, but all functions in this API will accept either the list or the container
 *        interchangeably.
 */
export function create_selectable(items, handler, {delete_handler, selected_id} = {}) {
  let container = document.createElement("div");
  container.classList.add(k_list_container_class);

  let list = document.createElement("ul");
  list.classList.add(k_selectable_class);
  container.append(list);

  for (const [item_id, ...item_contents] of items) {
    add_item_internal(list, item_id, item_contents, handler,
                      {delete_handler, selected: item_id == selected_id});
  }
  return container;
}

function get_container(el) {
  return el.closest("." + k_list_container_class);
}

function get_list(el) {
  return get_container(el).children[0];
}

export function clear_selection(list) {
  for (const el of list.getElementsByClassName(k_selected_item_class)) {
    el.classList.remove(k_selected_item_class);
  }
}

export function select_item(item) {
  clear_selection(get_container(item));
  item.classList.add(k_selected_item_class);
}

export function is_busy(list) {
  return m_busy_spinner.has_busy_spinner(get_container(list));
}

export function set_busy(list) {
  let container = get_container(list);
  if (is_busy(container)) {
    throw new Error("Attempted to set already busy box to busy");
  }

  let s = m_busy_spinner.create({with_overlay: true});
  container.append(s);
}

export function clear_busy(list) {
  let container = get_container(list);
  if (!is_busy(container)) {
    throw new Error("Attempted to clear busy status of non-busy box");
  }

  m_busy_spinner.remove_overlay(container);
}

export function get_item(list, id) {
  return list.querySelector(`li[${k_item_id_attribute}='${id}']`);
}

export function set_item_contents(item, ...elements) {
  let content_container = item.querySelector(`:scope > .${k_content_class}`);
  content_container.replaceChildren(...elements);
}

export function add_item(list, id, item_contents, handler, {delete_handler, selected} = {}) {
  add_item_internal(get_list(list), id, item_contents, handler, {delete_handler, selected});
}

function add_item_internal(list, id, item_contents, handler, {delete_handler, selected} = {}) {
  let item_el = document.createElement("li");
  let handler_arg = {list, item: item_el, id};
  item_el.setAttribute(k_item_id_attribute, id);
  item_el.addEventListener("click", async event => {
    event = event || window.event;
    event.stopPropagation();
    await handler(handler_arg);
  });
  if (selected) {
    item_el.classList.add(k_selected_item_class);
  }
  list.append(item_el);

  let content_container = document.createElement("div");
  content_container.classList.add(k_content_class);
  content_container.append(...item_contents);
  item_el.append(content_container);

  let spacer = document.createElement("div");
  spacer.classList.add(k_spacer_class);
  item_el.append(spacer);

  if (delete_handler) {
    let trash_button = document.createElement("button");
    trash_button.classList.add(k_trash_button_class);
    trash_button.addEventListener("click", async event => {
      event = event || window.event;
      event.stopPropagation();
      await delete_handler(handler_arg);
    });
    item_el.append(trash_button);
  }
}

export function remove_item(list, id) {
  const item = get_item(list, id);
  item.remove();
}

export function item_count(list) {
  return get_list(list).children.length;
}
