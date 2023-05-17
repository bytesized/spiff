import * as m_busy_spinner from "./busy_spinner.mjs";

const k_list_container_class = "list_container";
const k_selectable_class = "selectable";
const k_spacer_class = "spacer";
const k_trash_button_class = "trash";
const k_selected_item_class = "selected";
const k_item_id_attribute = "list_id";

/**
 * @param items
 *        An array describing the list items to be added to the created list. Each element in the
 *        array should be an array containing at least two items. The first should be a string
 *        representing the ID of the list item. The remaining can either be any combination of text
 *        string and DOM nodes that will be used as the contents of the corresponding list item
 *        element.
 * @param handler
 *        The callback function to be called when an item in the list is clicked. It will be passed
 *        a single argument that will be an object with these keys:
 *          list
 *            The list DOM element, which will be an `<ul>`.
 *          item
 *            The list item DOM element, which will be an `<li>`.
 *          id
 *            The ID from `item_map` that corresponds to the clicked list item.
 * @param delete_handler
 *        If passed, delete icons will be placed next to each list item and, when clicked, this
 *        handler will be invoked. The argument passed to it will be the same as the argument that
 *        would be passed to `handler`.
 * @param selected_id
 *        If passed, the item with this id will be selected. Otherwise, no item will initially be
 *        selected.
 * @return
 *        The created list element.
 */
export function create_selectable(items, handler, {delete_handler, selected_id} = {}) {
  let container = document.createElement("div");
  container.classList.add(k_list_container_class);

  let list = document.createElement("ul");
  list.classList.add(k_selectable_class);
  container.append(list);

  for (const [item_id, ...item_contents] of items) {
    let item_el = document.createElement("li");
    let handler_arg = {list, item: item_el, id: item_id};
    item_el.setAttribute(k_item_id_attribute, item_id);
    item_el.addEventListener("click", async event => {
      event = event || window.event;
      event.stopPropagation();
      await handler(handler_arg);
    });
    if (selected_id == item_id) {
      item_el.classList.add(k_selected_item_class);
    }
    list.append(item_el);

    let contents_container = document.createElement("div");
    contents_container.append(...item_contents);
    item_el.append(contents_container);

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
  return container;
}

function get_container(el) {
  return el.closest("." + k_list_container_class);
}

export function select_item(list, item) {
  for (const el of list.getElementsByClassName(k_selected_item_class)) {
    el.classList.remove(k_selected_item_class);
  }
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
  s.id = "foobar";
}

export function clear_busy_by_container(list) {
  let container = get_container(list);
  if (!is_busy(container)) {
    throw new Error("Attempted to clear busy status of non-busy box");
  }

  m_busy_spinner.remove_overlay(container);
}
