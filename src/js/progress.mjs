const k_progress_container_class = "progress_container";
const k_full_bar_color_attr = "full_bar_color";
const k_empty_bar_color_attr = "empty_bar_color";
const k_bar_width_attr = "bar_width";
const k_canvas_size_attr = "canvas_size";

/**
 * @returns
 *        A progress bar element that can be added to the DOM and passed to other functions in this
 *        module to be manipulated.
 */
export function create({full_bar_color, empty_bar_color, bar_width, initial_progress, size,
                        padding} = {}) {
  let style;
  if (!full_bar_color) {
    if (!style) {
      style = getComputedStyle(document.body);
    }
    full_bar_color = style.getPropertyValue("--accent_color");
  }
  if (!empty_bar_color) {
    if (!style) {
      style = getComputedStyle(document.body);
    }
    empty_bar_color = style.getPropertyValue("--subtle_accent_color");
  }
  if (!bar_width) {
    bar_width = 8;
  }
  if (!initial_progress) {
    initial_progress = 0;
  }
  if (!size) {
    size = 100;
  }

  let container = document.createElement("div");
  container.classList.add(k_progress_container_class);

  let canvas = document.createElement("canvas");
  container.append(canvas);

  if (padding) {
    canvas.style.padding = padding;
  }

  canvas.width = size;
  canvas.height = size;

  canvas.setAttribute(k_full_bar_color_attr, full_bar_color);
  canvas.setAttribute(k_empty_bar_color_attr, empty_bar_color);
  canvas.setAttribute(k_bar_width_attr, bar_width);
  canvas.setAttribute(k_canvas_size_attr, size);

  update(container, initial_progress);

  return container;
}

/**
 * @param progress_el
 *        A progress bar element created by this module's `create()` function.
 * @param progress_ratio
 *        A value between 0 and 1 indicating how much progress to display.
 */
export function update(progress_el, progress_ratio) {
  progress_ratio = Math.min(1, Math.max(0, progress_ratio));

  let canvas = progress_el.querySelector("canvas");

  let context = canvas.getContext("2d");
  context.reset();

  let full_bar_color = canvas.getAttribute(k_full_bar_color_attr);
  let empty_bar_color = canvas.getAttribute(k_empty_bar_color_attr);
  let bar_width = canvas.getAttribute(k_bar_width_attr);
  let size = canvas.getAttribute(k_canvas_size_attr);
  let middle = size / 2;

  let radius = middle - (bar_width / 2);

  context.beginPath();
  context.strokeStyle = empty_bar_color;
  context.lineWidth = bar_width;
  context.arc(middle, middle, radius, 0, 2 * Math.PI);
  context.stroke();

  if (progress_ratio == 0) {
    return;
  }

  context.beginPath();
  context.strokeStyle = full_bar_color;
  context.lineWidth = bar_width;
  context.lineCap = "round";
  context.arc(middle, middle, radius, Math.PI / -2, Math.PI * ((2 * progress_ratio) - (1 / 2)));
  context.stroke();
}
