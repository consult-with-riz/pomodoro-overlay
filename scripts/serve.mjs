/**
 * Minimal static file server over the repo root.
 *
 * Exists so the prototype harness can resolve /fonts/ during golden capture and
 * during the Playwright run. Not part of the shipped app.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, normalize, extname, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      // Strip the query and refuse anything trying to climb out of the root.
      const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(
        /^(\.\.[/\\])+/,
        ""
      );
      // Try the repo root, then public/ — Next serves public/ at /, and the
      // harness has to request /fonts/... exactly as the real app will.
      let file = null;
      for (const base of [ROOT, join(ROOT, "public")]) {
        const path = join(base, rel);
        if (!path.startsWith(ROOT)) continue;
        try {
          const info = await stat(path);
          file = info.isDirectory() ? join(path, "index.html") : path;
          break;
        } catch {
          // try the next base
        }
      }
      if (!file) {
        res.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      })
    );
  });
}

// Allow running it directly for manual poking: `node scripts/serve.mjs 4000`
// Compared via fileURLToPath because import.meta.url percent-encodes spaces in
// the path and argv[1] does not.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { url } = await serve(Number(process.argv[2]) || 4000);
  console.log(`Serving ${ROOT} at ${url}`);
}
