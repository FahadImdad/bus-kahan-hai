import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as proxyRequest } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("dist/client");
const upstream = { hostname: "localhost", port: 3001 };
const types = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const candidate = resolve(root, `.${normalize(pathname)}`);
  if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) {
    response.writeHead(200, { "Content-Type": types[extname(candidate)] || "application/octet-stream", "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
    createReadStream(candidate).pipe(response);
    return;
  }
  const proxy = proxyRequest({ ...upstream, path: request.url, method: request.method, headers: request.headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  proxy.on("error", () => { response.writeHead(502); response.end("Preview server unavailable"); });
  request.pipe(proxy);
}).listen(3000, "::1", () => console.log("Clean preview running at http://localhost:3000/"));
