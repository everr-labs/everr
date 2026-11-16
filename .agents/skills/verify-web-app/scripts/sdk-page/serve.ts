// verify-everr: static file server for the SDK page (web-sdk-page starts it in its own process
// group and web-cleanup stops it). Usage: node serve.ts <root> <port>. Loopback only.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const [root, port] = process.argv.slice(2);
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(root, rel);
  if (!file.startsWith(path.resolve(root) + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
