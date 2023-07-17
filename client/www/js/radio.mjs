import * as m_busy_spinner from "./busy_spinner.mjs";

const k_radio_container_class = "radio_container";
const k_radio_container_horizontal_class = "horizontal";
const k_radio_item_container_class = "radio_item";

const k_radio_group_name_prefix = "radio_group_";
const k_radio_input_id_prefix = "radio_input_";

let g_next_radio_group_id = 0;
let g_next_radio_input_id = 0;

/**
 * @param items
 *        An array describing the list items to be added to the created list. Each element in the
 *        array should be an array containing at least two items. The first should be a string
 *        representing the ID of the list item. The remaining can be any combination of text
 *        strings and DOM nodes that will be used as the label for the radio button
 * @param handler
 *        The callback function to be called when an item in the list is clicked. It will be passed
 *        a single argument that will be an object with these keys:
 *          radio_container
 *            The DOM element that was returned by `create`.
 *          id
 *            The ID from `items` that corresponds to the clicked list item.
 * @param horizontal
 *        If `true`, the radio buttons will be laid out horizontally rather than vertically.
 * @param selected_id
 *        If specified, 
 * @return
 *        A DOM element containing the described radio buttons.
 */
export function create(items, handler, {horizontal, selected_id} = {}) {
  const container = document.createElement("div");
  container.classList.add(k_radio_container_class);
  if (horizontal) {
    container.classList.add(k_radio_container_horizontal_class);
  }

  const group_name = k_radio_group_name_prefix + g_next_radio_group_id.toString();
  g_next_radio_group_id += 1;

  for (const [item_id, ...item_contents] of items) {
    const item_container = document.createElement("div");
    item_container.classList.add(k_radio_item_container_class);
    container.append(item_container);

    const input = document.createElement("input");
    input.id = k_radio_input_id_prefix + g_next_radio_input_id.toString();
    g_next_radio_input_id += 1;
    input.setAttribute("type", "radio");
    input.setAttribute("name", group_name);
    input.checked = item_id == selected_id;
    item_container.append(input);

    const handler_arg = {radio_container: container, id: item_id};
    input.addEventListener("change", async event => {
      event = event || window.event;
      event.stopPropagation();
      await handler(handler_arg);
    });

    const label = document.createElement("label");
    label.append(...item_contents);
    label.htmlFor = input.id;
    item_container.append(label);
  }
  return container;
}

export function is_busy(radio_container) {
  return m_busy_spinner.has_busy_spinner(radio_container);
}

export function set_busy(radio_container) {
  if (is_busy(radio_container)) {
    throw new Error("Attempted to set already busy radio container to busy");
  }

  let s = m_busy_spinner.create({with_overlay: true});
  radio_container.append(s);
}

export function clear_busy(radio_container) {
  if (!is_busy(radio_container)) {
    throw new Error("Attempted to clear busy status of non-busy radio container");
  }

  m_busy_spinner.remove_overlay(radio_container);
}
