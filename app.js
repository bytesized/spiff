"use strict";

const args = require("minimist")(process.argv.slice(2));
const http = require("http");
const path = require("path");

const client = require(path.join(__dirname, "client", "index"));

const hostname = "host" in args ? args.host : "127.0.0.1";
const port = "port" in args ? parseInt(args.port, 10) : 8080;

const control_c_buffer = Buffer.from([0x03]);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  console.log("Got request for ", url.href);
  const path_parts = url.pathname.split("/").filter(part => part.length > 0);
  if (path_parts.length < 1) {
    // The bare URL should get index.html, which is the client server responsibility.
    return client.handle(url, path_parts, request, response);
  }
  const module_name = path_parts.shift();
  switch (module_name) {
  case "client":
    return client.handle(url, path_parts, request, response);
  case "server":
    response.writeHead(500, {"Content-Type": "text/plain"});
    response.end("Server functionality not yet implemented");
    return;
  }
  response.writeHead(404, {"Content-Type": "text/plain"});
  response.end(`Unknown module: ${module_name}`);
});

server.listen(port, hostname, () => {
  console.log(`Started server at http://${hostname}:${port}/\n`);
});

process.stdin.on("data", key => {
  if (key.compare(control_c_buffer) == 0) {
    console.log("Got Control+C. Exiting...");

    // Closing everything we are using allows everything to shut down a bit more gracefully than
    // just forcing the process to exit.
    process.stdin.destroy();
    server.close();
  }
});
process.stdin.setRawMode(true);
