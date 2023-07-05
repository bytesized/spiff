import * as m_http from "http";
import minimist from "minimist";

import * as m_client from "./client/index.mjs";
import * as m_db from "./server/db.mjs"
import * as m_log from "./server/log.mjs";
import * as m_server from "./server/index.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "app");

const args = minimist(process.argv.slice(2));

const hostname = "host" in args ? args.host : "127.0.0.1";
const port = "port" in args ? parseInt(args.port, 10) : 8080;

const control_c_buffer = Buffer.from([0x03]);
let control_c_already_pressed = false;

k_log.info("Initializing...");
await m_server.init(args);

const server = m_http.createServer(async (request, response) => {
  try {
    request.setEncoding("utf8");
    let request_body = "";
    request.on("data", chunk => request_body += chunk);
    await new Promise(resolve => request.on("end", resolve));

    const url = new URL(request.url, `http://${request.headers.host}`);
    k_log.debug("Got request for ", url.href);
    const path_parts = url.pathname.split("/").filter(part => part.length > 0);
    if (path_parts.length < 1) {
      // The bare URL should get index.html, which is the client handler responsibility.
      return m_client.handle(url, path_parts, request, request_body, response);
    }
    const module_name = path_parts.shift();
    switch (module_name) {
    case "client":
      return m_client.handle(url, path_parts, request, request_body, response);
    case "server":
      return m_server.handle(url, path_parts, request, request_body, response);
    }
    response.writeHead(404, {"Content-Type": "text/plain"});
    response.end(`Unknown module: ${module_name}`);
  } catch (ex) {
    k_log.error("Unhandled exception", ex);
    response.writeHead(500, {"Content-Type": "text/plain"});
    response.end(`Unhandled exception`);
  }
});

server.listen(port, hostname, () => {
  k_log.info(`Started server at http://${hostname}:${port}/\n`);
});

process.stdin.on("data", async key => {
  if (key.compare(control_c_buffer) == 0) {
    if (!control_c_already_pressed) {
      control_c_already_pressed = true;
      k_log.warn("\nGot Control+C. Exiting...");
      // Closing everything we are using allows everything to shut down a bit more gracefully than
      // just forcing the process to exit.
      process.stdin.destroy();
      server.close();
      await m_db.destroy();
      k_log.info("Everything closed.");
    } else {
      k_log.warn("Second Control+C. Exiting more forcefully...");
      process.exit(1);
    }
  }
});
process.stdin.setRawMode(true);
