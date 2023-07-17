import * as m_log from "./log.mjs";
import * as m_request_shared from "../client/www/js/shared/request.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server/api_request");

// Server request rate limits.
const k_request_limits = [
  // Format is [allowed_request_count_per_time_period, time_period_in_milliseconds]
  [2, 1 * 1000],
  [10, 10 * 1000],
];
const k_past_requests_to_track_count = Math.max(...k_request_limits.map(l => l[0]));
const k_max_in_flight = Math.min(...k_request_limits.map(l => l[0]));
const k_duration_to_track_ms = Math.max(...k_request_limits.map(l => l[1]));

// An array of FIFO queues. Element format defined in `dispatch()`. Queues at lower indicies have
// higher priority.
let g_request_queues = [];
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
let g_no_requests_until_after = null;

// We are going to identify agents created prior to the last server reset via this error message
// sub-string
let k_outdated_token_message_substr = "Token reset_date does not match the server";

/**
 * Dispatches an API request to the API endpoint.
 * Doesn't necessarily dispatch it immediately. The request enters a queue of requests that are
 * dispatched with timing calculated to avoid exceeding the server's rate limits.
 * This function returns when a response is received.
 *
 * We attempt to dispatch API requests in the order that they are queued, but this should not be
 * relied upon. We sometimes send a request without having gotten a response from the previous one,
 * so it's possible that they could arrive out of order. It's also possible for requests to be
 * reordered if they have to be retried.
 *
 * @param path
 *        The path to the API endpoint, not including the "/v2/" prefix.
 * @param query
 *        The query string to be used in the URL, if any. The leading `?` character should not be
 *        included.
 * @param method
 *        The REST method to pass to `fetch` via its `options` parameter. If this is unspecified
 *        but `body` is, this will be set to "POST" automatically.
 * @param auth_token
 *        The Bearer Token used to authenticate as the currently selected agent.
 * @param body
 *        This will be passed to `JSON.stringify` and then to `fetch` via its `options` parameter.
 * @param priority
 *        The priority at which the request will be serviced. The most priority is given to
 *        requests with priority `0`, which is the default. Higher priority values are serviced
 *        only after lower priority valued requests have completed.
 * @return
 *        The return value will be an object with the following fields:
 *          success
 *            A boolean indicating whether or not the request completed successfully.
 *          payload (optional)
 *            An object created by parsing the JSON response from the server.
 *            This will not be present if the server does not respond with valid JSON.
 *          error_type (optional)
 *            One of the values from the `m_request_shared.e_request_error` enum. This will be
 *            present if `!success`.
 *          known_error (optional)
 *            One of the values from the `m_request_shared.e_known_error` enum. This will be
 *            present if `!success`.
 *          error_message (optional)
 *            A string containing a human-readable explanation of what went wrong. This will be
 *            present if `!success`.
 *          error_code (optional)
 *            An error code documented by https://docs.spacetraders.io/api-guide/response-errors
 *            This will be present if `!success` and an error code was provided in the response
 *            JSON sent by the server.
 */
export async function dispatch(path, {query, method, auth_token, body, priority} = {}) {
  return new Promise(resolve => {
    let request = {path, query, method, auth_token, body, callback: resolve};
    if (!priority) {
      priority = 0;
    }
    if (priority < 0) {
      throw new Error(`Invalid priority: ${priority}`);
    }
    while (g_request_queues.length <= priority) {
      g_request_queues.push([]);
    }
    g_request_queues[priority].push(request);
    k_log.debug("Added API call to", path, "to the priority", priority, "queue.");
    maybe_begin_processing();
  });
}

function maybe_begin_processing() {
  if (g_is_processing_queue) {
    k_log.debug("Queue is already being processed. No need to start processing.");
  } else {
    k_log.debug("Starting queue processing.");
    process_queue();
  }
}

function are_unprocessed_requests() {
  for (const queue of g_request_queues) {
    if (queue.length > 0) {
      return true;
    }
  }
  return false;
}

function shift_next_unprocessed_request() {
  for (let priority = 0; priority < g_request_queues.length; ++priority) {
    if (g_request_queues[priority].length > 0) {
      return [priority, g_request_queues[priority].shift()];
    }
  }
  throw new Error(`Attempted to shift next request but there isn't one.`);
}

function process_queue() {
  g_is_processing_queue = true;
  while (are_unprocessed_requests()) {
    let now = Date.now();
    k_log.debug("Queue processing in-progress at", now);

    if (g_in_flight_count >= k_max_in_flight) {
      // We'll resume processing the queue when we get a response to one of our in-flight requests.
      k_log.debug("Max items already in-flight.");
      g_is_processing_queue = false;
      return;
    }

    if (g_no_requests_until_after !== null) {
      if (g_no_requests_until_after < now) {
        k_log.debug("No-request-timer expired.");
        g_no_requests_until_after = null;
      } else {
        let wait = g_no_requests_until_after - now + 1;
        k_log.debug("No requests allowed for another", wait, "ms.");
        setTimeout(process_queue, wait);
        return;
      }
    }

    clean_past_request_list(now);
    k_log.debug("g_past_requests", () => JSON.stringify(g_past_requests));

    let next_wait = 0;
    for (const [request_count, time_period] of k_request_limits) {
      let remaining_count = request_count - g_in_flight_count;
      if (remaining_count > g_past_requests.length) {
        continue;
      }
      let next_req_time = g_past_requests[g_past_requests.length - remaining_count] + time_period;
      let wait = next_req_time - now;
      k_log.debug_if(wait > 0, "Sending a request now would violate the", request_count, "per",
                     time_period, "ms rule");
      if (wait > next_wait) {
        next_wait = wait;
      }
    }

    if (next_wait > 0) {
      k_log.debug("Waiting for", next_wait, "ms.");
      setTimeout(process_queue, next_wait);
      return;
    }

    const [priority, request] = shift_next_unprocessed_request();
    k_log.info("Dispatching request to", request.path, "(priority=", priority, ")");
    g_in_flight_count += 1;

    const api_endpoint = new URL("https://api.spacetraders.io");
    api_endpoint.pathname = "v2/" + request.path;
    if (request.query) {
      api_endpoint.search = "?" + request.query;
    }
    const options = {
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
    };
    if (request.method) {
      options.method = request.method;
    } else if (request.body) {
      options.method = "POST";
    }
    if (request.auth_token) {
      options.headers.Authorization = "Bearer " + request.auth_token;
    }
    if (request.body) {
      options.body = JSON.stringify(request.body);
    }
    fetch(api_endpoint.href, options).then(
      async response => {
        g_in_flight_count -= 1;

        const response_received_time = Date.now();
        const response_sent_time = get_single_header(response, "date", response_received_time);
        g_past_requests.push(response_received_time);

        // Originally we set the rate limit any time `retry-after` was specified. But it seems to
        // specify it way more often than necessary.
        let should_rate_limit = (response.status == 429);

        if (should_rate_limit) {
          let retry_at = null;
          let retry_header = get_single_header(response, "retry-after");
          if (retry_header != null) {
            let retry_delay = parseInt(retry_header, 10);
            if (isNaN(retry_delay)) {
              k_log.warn("retry-after header has a non-integer value:", retry_header);
            } else {
              retry_at = response_sent_time + (retry_delay * 1000)
            }
          }
          if (retry_at == null) {
            retry_header = get_single_header(response, "x-ratelimit-reset");
            if (retry_header != null) {
              retry_at = Date.new(retry_header).getTime();
            }
          }
          if (retry_at == null) {
            k_log.warn(
              "We ought to rate limit ourselves, but the server didn't give any guidance for",
              "when it's ok to retry next."
            );
          } else {
            if (g_no_requests_until_after == null) {
              g_no_requests_until_after = retry_at;
            } else {
              g_no_requests_until_after = Math.max(g_no_requests_until_after, retry_at);
            }
            k_log.warn(
              "Server requests that client waits. Hit limit of type: ",
              () => get_single_header(response, "x-ratelimit-type", "[unknown]"), ", burst",
              () => get_single_header(response, "x-ratelimit-limit-burst", "[unknown]"), "per",
              () => get_single_header(response, "x-ratelimit-limit-per-second", "[unknown]"),
              "sec. Retrying in",
              () => g_no_requests_until_after - response_received_time,
              "ms"
            );
          }
        }

        if (response.status == 429) {
          g_request_queues[priority].unshift(request);
          k_log.warn("HTTP 429 - Need to retry request");
          maybe_begin_processing();
          return;
        }

        k_log.info("Response from", request.path, "sent at", response_sent_time, "received at",
                   response_received_time);
        let result = {success: response.ok};
        try {
          result.payload = await response.json();
        } catch (ex) {
          k_log.warn("Failed to parse response JSON");
          if (result.success) {
            result.success = false;
            result.error_type = m_request_shared.e_request_error.json;
          }
        }
        if (!result.success) {
          result.known_error = m_request_shared.e_known_error.none;
          if (result?.payload?.error && "message" in result.payload.error) {
            result.error_message = `Server says: ${result?.payload?.error?.message}`;
          }
          result.error_code = result?.payload?.error?.code;
          if (result.error_code == 401) {
            const message = result?.payload?.error?.message;
            if (typeof message == "string" && message.includes(k_outdated_token_message_substr)) {
              result.known_error = m_request_shared.e_known_error.outdated_token;
            }
          }
          if (response.status >= 400 && response.status <= 499) {
            result.error_type = m_request_shared.e_request_error.client;
          } else if (response.status >= 500 && response.status <= 599) {
            result.error_type = m_request_shared.e_request_error.server;
          } else {
            result.error_type = m_request_shared.e_request_error.status_code;
          }
          if (result.known_error != m_request_shared.e_known_error.none) {
            result.error_message = m_request_shared.k_known_error_message[result.known_error];
          } else if (!result.error_message) {
            result.error_message =
              m_request_shared.k_request_error_default_message[result.error_type];
          }
          if (result.known_error != m_request_shared.e_known_error.none) {
            k_log.warn("Request failed in known way:", result.known_error);
          } else {
            k_log.warn("Request failed", response, result.error_message);
          }
        }
        maybe_begin_processing();
        request.callback(result);
      },
      ex => {
        k_log.error("Failed to send request", ex);
        g_in_flight_count -= 1;

        let result = {success: false};
        result.error_type = m_request_shared.e_request_error.server_exception;
        result.known_error = m_request_shared.e_known_error.none;
        result.error_message = m_request_shared.k_request_error_default_message[result.error_type];

        maybe_begin_processing();
        request.callback(result);
      }
    );
  }

  k_log.debug("Queue is fully processed.");
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

// This functions similarly to `Headers.get()` except that it returns an array of matching headers.
// `Headers.get()` returns a comma separated list for some goofy reason.
function get_headers(response, name) {
  let search_name =  name.toLowerCase();
  let values = [];
  for (const [header_name, header_value] of response.headers) {
    if (header_name.toLowerCase() == search_name) {
      values.push(header_value);
    }
  }
  return values;
}

// It would be more efficient for this to only look until it found a single matching header. But,
// at least for now, I'd like warnings about extra headers.
function get_single_header(response, name, default_val = null) {
  let matching_headers = get_headers(response, name);
  if (matching_headers.length < 1) {
    return default_val;
  }
  if (matching_headers.length > 1) {
    k_log.warn("Expected response to have a single", name, "header, but it has",
               matching_headers.length);
  }
  return matching_headers[0];
}
