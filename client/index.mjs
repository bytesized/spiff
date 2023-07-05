import {promises as m_fs} from "fs";
import * as m_path from "path";
import * as m_url from "url";

const client_data_dir = "www";
const client_index_filename = "index.html";

const content_types = {
  [client_index_filename]: "text/html",
  img: "image/svg+xml",
  js: "text/javascript",
  style: "text/css",
};

export async function handle(url, path_parts, request, request_body, response) {
  const client_dir = m_path.dirname(m_url.fileURLToPath(import.meta.url));
  let file_path = m_path.join(client_dir, client_data_dir);
  let content_type;
  if (path_parts.length < 1) {
    file_path = m_path.join(file_path, client_index_filename);
    content_type = content_types[client_index_filename];
  } else {
    const subdir = path_parts[0];
    if (!(subdir in content_types)) {
      response.writeHead(404, {"Content-Type": "text/plain"});
      response.end(`Unrecognized sub directory: "${subdir}"`);
      return;
    }

    content_type = content_types[path_parts[0]];
    for (const part of path_parts) {
      if (part.startsWith(".")) {
        response.writeHead(400, {"Content-Type": "text/plain"});
        response.end(`Invalid path component: "${part}"`);
        return;
      }
      file_path = m_path.join(file_path, part);
    }
  }

  let handle;
  try {
    const handle = await m_fs.open(file_path, "r");
    const stat = await handle.stat();
    const stream = handle.createReadStream();
    response.writeHead(200, {
      "Content-Type": content_type,
      "Content-Length": stat.size,
    });
    stream.pipe(response);
  } catch (ex) {
    if (ex.code == "ENOENT") {
      response.writeHead(404, {"Content-Type": "text/plain"});
      response.end("404: File Not Found");
    } else {
      console.log(ex);
      response.writeHead(500, {"Content-Type": "text/plain"});
      response.end("Failed to read file");
    }
  }
}
