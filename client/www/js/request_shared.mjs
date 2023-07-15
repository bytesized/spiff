export const e_request_error = Object.freeze({
  client_exception: "e_request_error::client_exception",
  server_exception: "e_request_error::server_exception",
  json: "e_request_error::json",
  client: "e_request_error::client",
  server: "e_request_error::server",
  status_code: "e_request_error::status_code",
});

export const k_request_error_default_message = Object.freeze({
  [e_request_error.client_exception]: "fetch() threw an exception on the client.",
  [e_request_error.server_exception]: "fetch() threw an exception on the server.",
  [e_request_error.json]: "Server response was not valid JSON.",
  [e_request_error.client]: "Client Error - Something was wrong with the API request made.",
  [e_request_error.server]: "Server Error",
  [e_request_error.status_code]: "Unexpected status code.",
});

export const e_known_error = Object.freeze({
  none: "e_known_error::none",
  outdated_token: "e_known_error::outdated_token",
});

export const k_known_error_message = Object.freeze({
  [e_known_error.none]: "No specifically known error applies to this response",
  [e_known_error.outdated_token]: "Server has been reset since this agent was created",
});
