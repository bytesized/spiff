import * as m_log from "./log.mjs";

const k_log = new m_log.Logger(m_log.e_log_level.warn, "fn_queue");

/**
 * Runs all the `push`ed async functions, in order. Logs but otherwise ignores errors thrown by
 * promises.
 */
export class Queue {
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
