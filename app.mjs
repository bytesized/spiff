import {promises as m_fs} from "fs";
import * as m_http from "http";
import * as m_https from "https";
import minimist from "minimist";

import * as m_client from "./client/index.mjs";
import * as m_log from "./server/log.mjs";
import * as m_server from "./server/index.mjs";

const k_log = new m_log.logger(m_log.e_log_level.info, "app");

const args = minimist(process.argv.slice(2));

const use_https = !args.insecure;
const server_options = {};

let default_port = 8080;
let default_host = "127.0.0.1";
if (use_https) {
  default_port = 443;
  default_host = "192.168.42.1";
  const default_key_path = "/etc/letsencrypt/live/narcoticcats.net/privkey.pem";
  const default_cert_path = "/etc/letsencrypt/live/narcoticcats.net/fullchain.pem";

  const key_path = "key" in args ? args.key : default_key_path;
  const cert_path = "cert" in args ? args.cert : default_cert_path;

  server_options.key = await m_fs.readFile(key_path);
  server_options.cert = await m_fs.readFile(cert_path);
}

const hostname = "host" in args ? args.host : default_host;
const port = "port" in args ? parseInt(args.port, 10) : default_port;

const control_c_buffer = Buffer.from([0x03]);

k_log.info("Initializing...");
await m_server.init(args);
k_log.info("Initialization done.");

async function handle_request(request, response) {
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
};

let server;
if (use_https) {
  server = m_https.createServer(server_options, handle_request);
} else {
  server = m_http.createServer(server_options, handle_request);
}

server.listen(port, hostname, () => {
  k_log.info(`Started server at http://${hostname}:${port}/\n`);
});

process.stdin.on("data", async key => {
  if (key.compare(control_c_buffer) == 0) {
    k_log.warn("\nGot Control+C. Exiting...");
    // Closing everything we are using allows everything to shut down a bit more gracefully than
    // just forcing the process to exit.
    process.stdin.setRawMode(false);
    process.stdin.destroy();
    k_log.info("Closing handlers and database...");
    await m_server.shutdown();
    k_log.info("Closing server...");
    await new Promise(resolve => server.close(resolve));
    k_log.info("Everything closed.");
  }
});
process.stdin.setRawMode(true);
