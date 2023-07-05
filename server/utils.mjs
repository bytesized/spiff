export function respond_success(log, response, response_object) {
  log.debug("Returning", response_object);
  response.writeHead(200, {"Content-Type": "application/json"});
  response.end(JSON.stringify(response_object));
}

export function respond_error(log, response, code, message) {
  log.warn(message);
  response.writeHead(code, {"Content-Type": "application/json"});
  response.end(JSON.stringify({success: false, error_message: message}));
}
