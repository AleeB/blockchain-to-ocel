/**
 * Minimal static HTTP server for the blockchain-to-ocel HTML wizard.
 * Serves the project root so that:
 *
 * Usage:  node server.js [port] (default: 3000)
 */

import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 3000;
const ROOT = resolve(__dirname, ".."); // root del progetto

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  let pathname = req.url.split("?")[0];

  // root -> serve the wizard page
  if (pathname === "/" || pathname === "") pathname = "/public/index.html";

  const filePath = join(ROOT, pathname);

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`404 — ${pathname}`);
  }
}).listen(PORT, () => {
  console.log(`\nblockchain-to-ocel server started. Go to:`);
  console.log(`   http://localhost:${PORT}\n`);
});
