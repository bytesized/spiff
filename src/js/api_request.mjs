import * as m_log from "./log.mjs";

const log = new m_log.logger(m_log.e_log_level.debug, "api_request");

// Server request rate limits.
const k_request_limits = [
  // Format is [allowed_request_count_per_time_period, time_period_in_milliseconds]
  [2, 1 * 1000],
  [10, 10 * 1000],
];
const k_past_requests_to_track_count = Math.max(...k_request_limits.map(l => l[0]));
const k_max_in_flight = Math.min(...k_request_limits.map(l => l[0]));
const k_duration_to_track_ms = Math.max(...k_request_limits.map(l => l[1]));

// FIFO queue. Element format defined in `dispatch()`.
let g_request_queue = [];
// FIFO queue. Elements are timestamps representing the times that previous requests were received
// by the server, stored as milliseconds since the epoch.
// Items are added to this queue when the response is received, not when the request is sent.
// Earliest items are evicted when they are older than `k_duration_to_track_ms` or when there are
// more than `k_past_requests_to_track_count` of them.
let g_past_requests = [];
let g_in_flight_count = 0;

let g_is_processing_queue = false;

// If the server gives a "Too Many Requests" error with a "retry-after" field, we will use this
// field to store that information.
// TODO: Implement setting this
let g_no_requests_until_after = null;

/**
 * Dispatches an API request to the API endpoint.
 * Doesn't necessarily dispatch it immediately. The request enters a queue of requests that are
 * dispatched with timing calculated to avoid exceeding the server's rate limits.
 * This function returns when a response is received.
 *
 * @param path
 *        The path to the API endpoint, not including the "/v2/" prefix.
 * @param method
 *        The REST method to pass to `fetch` via its `options` parameter.
 * @param auth_token
 *        The Bearer Token used to authenticate as the currently selected agent.
 * @param body
 *        This will be passed to `JSON.stringify` and then to `fetch` via its `options` parameter.
 * @return
 *        TODO: Figure out return format.
 */
export async function dispatch(path, {method, auth_token, body} = {}) {
  return new Promise(resolve => {
    let request = {path, method, auth_token, body, callback: resolve};
    g_request_queue.push(request);
    log.debug("Added API call to", path, "to the queue.");
    maybe_begin_processing();
  });
}

function maybe_begin_processing() {
  if (g_is_processing_queue) {
    log.debug("Queue is already being processed. No need to start processing.");
  } else {
    log.debug("Starting queue processing.");
    process_queue();
  }
}

function process_queue() {
  g_is_processing_queue = true;
  while (g_request_queue.length > 0) {
    let now = Date.now();
    log.debug("Queue processing in-progress at", now);

    if (g_in_flight_count >= k_max_in_flight) {
      // We'll resume processing the queue when we get a response to one of our in-flight requests.
      log.debug("Max items already in-flight.");
      g_is_processing_queue = false;
      return;
    }

    if (g_no_requests_until_after !== null) {
      if (g_no_requests_until_after < now) {
        log.debug("No-request-timer expired.");
        g_no_requests_until_after = null;
      } else {
        let wait = g_no_requests_until_after - now + 1;
        log.debug("No requests allowed for another", wait, "ms.");
        setTimeout(process_queue, wait);
        return;
      }
    }

    clean_past_request_list(now);
    log.debug("g_past_requests", () => JSON.stringify(g_past_requests));

    let next_wait = 0;
    for (const [request_count, time_period] of k_request_limits) {
      let remaining_count = request_count - g_in_flight_count;
      if (remaining_count > g_past_requests.length) {
        continue;
      }
      let next_req_time = g_past_requests[g_past_requests.length - remaining_count] + time_period;
      let wait = next_req_time - now;
      log.debug_if(wait > 0, "Sending a request now would violate the", request_count, "per",
                   time_period, "ms rule");
      if (wait > next_wait) {
        next_wait = wait;
      }
    }

    if (next_wait > 0) {
      log.debug("Waiting for", next_wait, "ms.");
      setTimeout(process_queue, next_wait);
      return;
    }

    let request = g_request_queue.shift();
    log.debug("Dispatching request to", request.path);
    g_in_flight_count += 1;
    let on_response = (response, request_received) => {
      g_in_flight_count -= 1;
      g_past_requests.push(request_received);
      log.debug("Response from", request.path, "received at", () => Date.now(),
                ". Server received it at ", request_received);
      maybe_begin_processing();
      request.callback(response);
    };
    // TODO: Actually fetch the request.
    setTimeout(() => {
      let received = Date.now();
      setTimeout(() => {
        on_response(`path: ${request.path}, sent at ${now}`, received);
      }, 1);
    }, 1);
  }

  log.debug("Queue is fully processed.");
  g_is_processing_queue = false;
}

function clean_past_request_list(now) {
  if (g_past_requests.length > k_past_requests_to_track_count) {
    g_past_requests.splice(0, g_past_requests.length - k_past_requests_to_track_count);
  }
  const cutoff = now - k_duration_to_track_ms;
  while (g_past_requests[0] < cutoff) {
    g_past_requests.shift();
  }
}
