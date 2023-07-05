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
