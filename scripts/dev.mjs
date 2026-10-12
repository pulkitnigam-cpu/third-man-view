// Local dev server: serves public/ and runs api/*.js with a minimal Vercel-style req/res. Reads .env if present.
// Usage: node scripts/dev.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const PORT = +(process.argv[2] || process.env.PORT || 5173);
for (const f of [".env", ".env.local"]) {
  try { for (const l of fs.readFileSync(path.join(ROOT, f), "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch {}
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".mp3": "audio/mpeg", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const file = path.join(ROOT, "api", path.basename(url.pathname) + ".js");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    let raw = ""; for await (const c of req) raw += c;
    req.body = raw && (req.headers["content-type"] || "").includes("json") ? JSON.parse(raw) : raw;
    req.query = Object.fromEntries(url.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    try { const mod = await import(pathToFileURL(file).href + "?t=" + fs.statSync(file).mtimeMs); await mod.default(req, res); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
    return;
  }
  let p = path.normalize(path.join(PUB, decodeURIComponent(url.pathname)));
  if (!p.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`Third Man View on http://localhost:${PORT}`));
