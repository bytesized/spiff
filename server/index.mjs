import * as m_db from "./db.mjs";
import * as m_log from "./log.mjs";
import * as m_server_reset from "./server_reset.mjs";

const k_log = new m_log.logger(m_log.e_log_level.warn, "server");

const modules = {
  agent: await import("./modules/agent.mjs"),
  forward: await import("./modules/forward.mjs"),
};

export async function init(args) {
  await m_db.init(args);
  // Requires: m_db
  await m_server_reset.init(args);

  // Do module initialization last. They often depend on other things and nothing depends on them.
  for (const module_name in modules) {
    if ("init" in modules[module_name]) {
      await modules[module_name].init(args);
    }
  }
}

export async function shutdown() {
  for (const module_name in modules) {
    if ("shutdown" in modules[module_name]) {
      await modules[module_name].init(args);
    }
  }

  await m_server_reset.shutdown();
  await m_db.shutdown();
}

export async function handle(url, path_parts, request, request_body, response) {
  if (path_parts.length < 1) {
    const message = "Specify module in server";
    k_log.warn(message);
    response.writeHead(400, {"Content-Type": "application/json"});
    response.end(JSON.stringify({success: false, error: {message}}));
    return;
  }

  const module_name = path_parts.shift();
  if (!(module_name in modules)) {
    const message = `No such module: "${module_name}"`;
    k_log.warn(message);
    response.writeHead(404, {"Content-Type": "application/json"});
    response.end(JSON.stringify({success: false, error: {message}}));
    return;
  }

  let request_json = {};
  if (request_body.length > 0) {
    try {
      request_json = JSON.parse(request_body);
    } catch (ex) {
      const message = `JSON Parse failure: "${ex}"`;
      k_log.error("JSON Parse failure", ex);
      response.writeHead(404, {"Content-Type": "application/json"});
      response.end(JSON.stringify({success: false, error: {message}}));
      return;
    }
  }

  k_log.debug("Server delegating request to module", module_name);
  try {
    await modules[module_name].handle(url, path_parts, request, request_json, response);
  } catch (ex) {
    const message = `Unhandled exception: ${ex}`;
    k_log.error("Unhandled exception", ex);
    response.writeHead(500, {"Content-Type": "application/json"});
    response.end(JSON.stringify({success: false, error: {message}}));
    return;
  }
}
