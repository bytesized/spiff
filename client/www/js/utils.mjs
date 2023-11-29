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

/**
 * @param box
 *        A `DOMRect`, typically one returned by `Element.getBoundingClientRect()`.
 * @param x
 *        The x coordinate of the point to check.
 * @param y
 *        The y coordinate of the point to check.
 * @returns
 *        `true` if (`x`, `y`) lies within `box`, else `false`.
 */
export function bound_box_contains(box, x, y) {
  if (box.width == 0 || box.height == 0) {
    // Even if the point is directly over the box location, never consider anything to be within a
    // zero-sized box.
    return false;
  }
  return box.top <= y && box.bottom >= y && box.left <= x && box.right >= x;
}

export function object_is_empty(object) {
  for (const prop in object) {
    return false;
  }
  return true;
}

export function object_length(object) {
  let length = 0;
  for (const prop in object) {
    length += 1;
  }
  return length;
}

/**
 * Functions identically to `Array.prototype.reduce` but operates on an object and the third
 * callback parameter is the current key instead of the current index.
 */
export function object_reduce(object, callback, initial_value) {
  let accumulator;
  let first_pass = true;
  for (const key in object) {
    if (first_pass) {
      first_pass = false;
      if (arguments.length < 3) {
        accumulator = object[key];
        continue;
      }
      accumulator = initial_value;
    }
    accumulator = callback(accumulator, object[key], key, object);
  }
  if (first_pass) {
    if (arguments.length < 3) {
      throw new TypeError("Cannot reduce empty object with no initial value");
    } else {
      return initial_value;
    }
  }
  return accumulator;
}
