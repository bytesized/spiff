const k_spinner_class = "busy_spinner";
const k_busy_overlay_class = "sub_spinner_overlay";

export const e_spinner_size = Object.freeze({
  medium: "e_spinner_size::medium",
  large: "e_spinner_size::large",
  x_large: "e_spinner_size::x_large",
});

const k_spinner_size_class = Object.freeze({
  [e_spinner_size.medium]: "medium_size",
  [e_spinner_size.large]: "large_size",
  [e_spinner_size.x_large]: "x_large_size",
});

/**
 * @param with_overlay
 *        If `true`, this function returns a semi-opaque overlay containing a spinner rather than
 *        just a spinner.
 * @param size
 *        If specified, should be a value of `e_spinner_size` specifying the (maximum) size of the
 *        spinner. If this isn't specified, and `with_overlay == true`, the spinner will take up
 *        as much of the overlay as possible while retaining its aspect ratio. If this isn't
 *        specified and `with_overlay == false`, the element should have either its width or height
 *        specified by the caller.
 * @returns
 *        An spinner element. If `with_overlay = true`, the overlay element containing the spinner
 *        element will be returned.
 */
export function create({with_overlay, size} = {}) {
  let el = document.createElement("div");
  el.classList.add(k_spinner_class);
  if (size) {
    el.classList.add(k_spinner_size_class[size]);
  }

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
