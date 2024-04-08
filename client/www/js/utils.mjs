import * as m_log from "./log.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.warn, "utils");

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

/**
 * Runs all the `push`ed async functions, in order. Logs but otherwise ignores errors thrown by
 * promises.
 */
export class FunctionQueue {
  #name;
  #queue = [];
  #running = false;
  #queue_complete_promise = null;
  #before_start_listeners = [];
  #after_stop_listeners = [];

  /**
   * @param name
   *        The queue's name, used in logging.
   */
  constructor(name) {
    this.#name = name;
  }

  get is_running() {
    return this.#running;
  }

  // "busy" includes running listeners whereas "running" only includes running the actual queue
  // functions.
  get is_busy() {
    return !!this.#queue_complete_promise;
  }

  push(fn) {
    k_log.debug(this.#name, "- Function pushed");
    this.#queue.push(fn);
    // Do not await on result. Just kick it off.
    this.#maybe_start_queue();
  }

  on_before_start(listener) {
    this.#before_start_listeners.push(listener);
  }

  on_after_stop(listener) {
    this.#after_stop_listeners.push(listener);
  }

  async #maybe_start_queue() {
    if (this.is_busy) {
      k_log.debug(this.#name, "- No need to start queue; it's already running.");
      return;
    }
    if (this.#queue.length < 1) {
      k_log.warn(this.#name, "- Nothing to run?");
      return;
    }

    let promise_resolve_fn;
    try {
      this.#queue_complete_promise = new Promise(resolve => {promise_resolve_fn = resolve});

      // We have a loop enclosing the whole queue running process just in case an item is added to
      // the queue while we are firing the "after queue stop" listeners.
      while (this.#queue.length > 0) {
        k_log.debug(this.#name, "- Starting queue.");

        let listener_results =
          await Promise.allSettled(this.#before_start_listeners.map(fn => fn()));
        for (const listener_result of listener_results) {
          if (listener_result.status == "rejected") {
            k_log.error(this.#name, "- Queue start listener error:", listener_result.reason);
          }
        }

        k_log.debug(this.#name, "- Queue start listeners complete.");
        this.#running = true;

        while (this.#queue.length > 0) {
          k_log.debug(this.#name, "- Running queue function.");
          const to_run = this.#queue.shift();
          try {
            await to_run();
          } catch (ex) {
            k_log.error(this.#name, "- Queue function failed:", ex);
          }
        }

        this.#running = false;
        k_log.debug(this.#name, "- Queue empty. Stopping.");

        listener_results =
          await Promise.allSettled(this.#after_stop_listeners.map(fn => fn()));
        for (const listener_result of listener_results) {
          if (listener_result.status == "rejected") {
            k_log.error(this.#name, "- Queue empty listener error:", listener_result.reason);
          }
        }

        k_log.debug(this.#name, "- Queue empty listeners complete.");
      }
    } catch (ex) {
      k_log.error(this.#name, "- Internal error running queue:", ex);
    } finally {
      this.#running = false;
      this.#queue_complete_promise = null;
      try {
        promise_resolve_fn();
      } catch (ex) {
        k_log.warning(this.#name, "- Promise resolve function failed:", ex);
      }
      k_log.debug(this.#name, "- Queue stopped.");
    }
  }

  async until_complete() {
    if (this.#queue_complete_promise) {
      await this.#queue_complete_promise;
    }
  }
}

export const e_promise_status = Object.freeze({
  unresolved: "e_promise_status::unresolved",
  resolved: "e_promise_status::resolved",
  rejected: "e_promise_status::rejected",
  destroyed: "e_promise_status::destroyed",
});

export class SmartPromise {
  #promise;
  #resolve;
  #reject;

  // We are going to use this to do something ugly and hacky.
  // The purpose of this is to address a problem when this sort of thing happens:
  //  ```
  //    let resolve;
  //    const promise = new Promise(r => {resolve = r});
  //    let s = new SmartPromise({promise});
  //    s.reset({promise: new_promise});
  //    resolve();
  //  ```
  // This should not cause `s` to resolve, but there isn't a good way to disconnect `s` from the
  // functions that we pass to `promise.then` in `s`'s constructor to connect them. Nor is there an
  // especially good way for those functions to know that `s` has been reset.
  // So what we do is, when we attach to `promise` using its `then` method, we capture the current
  // array in `this.#promise_valid` into that scope. Now when the `SmartPromise` calls
  // `this.#promise_valid[0] = false;`, this changes the contents of the array in that scope. And
  // when `SmartPromise` calls `this.#promise_valid = [true];`, it releases control of the array in
  // the previously captured scope and creates a new one for another promise to potentially be
  // linked to.
  // This allows us to let the Promise's `then` functions know that the Promise is invalid so that
  // they don't have any effects on the previously-linked `SmartPromise`.
  #promise_valid = [true];

  #status;
  #result;

  #on_complete;
  #on_resolve;
  #on_reject;

  static resolve(value) {
    const p = new SmartPromise();
    p.resolve(value);
    return p;
  }

  /**
   * @param on_complete
   *        Callback to call when the Promise resolves or rejects. Called with arguments
   *        `this.status` and `this.result`.
   * @param on_resolve
   *        Callback to call when the Promise resolves. Called with argument `this.result`.
   * @param on_reject
   *        Callback to call when the Promise rejects. Called with argument `this.result`.
   * @param promise
   *        A Promise to use as the "underlying Promise". The constructed instance will resolve or
   *        reject when it does.
   */
  constructor({on_complete, on_resolve, on_reject, promise} = {}) {
    this.#on_complete = on_complete;
    this.#on_resolve = on_resolve;
    this.#on_reject = on_reject;

    this.reset({promise});
  }

  /**
   * This is basically meant to be used in one of two cases:
   *  1. This instance was given an underlying Promise to link to, but we no longer care about the
   *     result of that Promise (and optionally want to replace it with a different Promise).
   *  2. This instance has completed and we want to reuse it.
   *
   * @param promise
   *        A new promise to be used to resolve this `SmartPromise`.
   */
  reset({promise}) {
    this.#status = e_promise_status.unresolved;

    this.#promise = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });

    this.#invalidate_linked_promises();

    if (promise) {
      this.#link_promise(promise);
    }
  }

  #link_promise(promise) {
    // Capture the current array into this context so that, when the promise fires, we get the
    // instance of the `#promise_valid` array that was in use now, not the one in use when the
    // promise fires.
    const promise_valid = this.#promise_valid;
    promise.then(value => {
      if (promise_valid[0]) {
        this.resolve(value);
      }
    }, value => {
      if (promise_valid[0]) {
        this.reject(value);
      }
    });
  }

  /**
   * Effectively "disconnects" a promise that was previously linked to this `SmartPromise` with
   * `this.#link_promise`.
   */
  #invalidate_linked_promises() {
    // See the comment on the declaration of `this.#promise_valid` for an explanation of this
    // nonsense.
    this.#promise_valid[0] = false;
    this.#promise_valid = [true];
  }

  /**
   * @param value
   *        The value to resolve with.
   * @returns
   *        `true` if this resolved the Promise. `false` if the promise already settled.
   */
  resolve(value) {
    if (this.#status != e_promise_status.unresolved) {
      return false;
    }

    this.#status = e_promise_status.resolved;
    this.#result = value;

    if (this.#on_resolve) {
      try {
        this.#on_resolve(value);
      } catch (ex) {
        k_log.error("SmartPromise on_resolve error", ex);
      }
    }

    if (this.#on_complete) {
      try {
        this.#on_complete(this.#status, value);
      } catch (ex) {
        k_log.error("SmartPromise on_complete error", ex);
      }
    }

    this.#resolve(value);
    return true;
  }

  /**
   * @param value
   *        The value to reject with.
   * @returns
   *        `true` if this resolved the Promise. `false` if the promise already settled.
   */
  reject(value) {
    if (this.#status != e_promise_status.unresolved) {
      return false;
    }

    this.#status = e_promise_status.rejected;
    this.#result = value;

    if (this.#on_reject) {
      try {
        this.#on_reject(value);
      } catch (ex) {
        k_log.error("SmartPromise on_reject error", ex);
      }
    }

    if (this.#on_complete) {
      try {
        this.#on_complete(this.#status, value);
      } catch (ex) {
        k_log.error("SmartPromise on_complete error", ex);
      }
    }

    this.#reject(value);
    return true;
  }

  /**
   * Prevents the `SmartPromise` from ever completing.
   *
   * @returns
   *        `true` if this destroyed the Promise. `false` if the promise already settled.
   */
  destroy() {
    if (this.#status != e_promise_status.unresolved) {
      return false;
    }

    this.#status = e_promise_status.destroyed;
  }

  async until_complete() {
    return this.#promise;
  }

  get status() {
    return this.#status;
  }

  /**
   * The value resolved or rejected with. Valid only if
   * `this.status != e_promise_status.unresolved`.
   */
  get result() {
    return this.#result;
  }
}
