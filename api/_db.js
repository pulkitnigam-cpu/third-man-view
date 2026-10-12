// Neon Postgres (optional). Two jobs:
//   1. a shared cache for the rate-limited sources (CricketData 100/day, Cricbuzz 200/month, Gemini search), so a cold
//      serverless function doesn't spend quota again on something another instance fetched an hour ago;
//   2. a history of every brief, newsletter and report sent to Arjun on Telegram.
// Without DATABASE_URL every helper quietly does nothing and the app runs on in-memory caches, as before.
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const sql = url ? neon(url) : null;
export const dbReady = () => !!sql;

let schema;
function ensure() {
  if (!sql) return Promise.resolve(false);
  schema ||= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS cache (key text PRIMARY KEY, data jsonb, until timestamptz NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS reports (
      id serial PRIMARY KEY, kind text NOT NULL, title text NOT NULL, match_key text, markdown text NOT NULL,
      delivered boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())`;
    await sql`CREATE INDEX IF NOT EXISTS reports_created ON reports (created_at DESC)`;
    return true;
  })().catch((e) => { schema = null; console.error("db schema:", e.message); return false; });
  return schema;
}

// undefined = not cached (or no database); null is a valid cached value ("source had no data")
export async function cacheGet(key) {
  if (!(await ensure())) return undefined;
  try {
    const rows = await sql`SELECT data FROM cache WHERE key = ${key} AND until > now()`;
    return rows.length ? rows[0].data : undefined;
  } catch { return undefined; }
}

export async function cacheSet(key, data, ttlSec) {
  if (!(await ensure())) return;
  try {
    await sql`INSERT INTO cache (key, data, until) VALUES (${key}, ${JSON.stringify(data)}::jsonb, now() + ${ttlSec} * interval '1 second')
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, until = EXCLUDED.until`;
    if (Math.random() < 0.02) await sql`DELETE FROM cache WHERE until < now() - interval '1 day'`; // occasional tidy-up
  } catch {}
}

export async function saveReport({ kind, title, matchKey, markdown, delivered }) {
  if (!(await ensure())) return null;
  try {
    // a resend of the same text updates the earlier row instead of adding a duplicate
    const same = await sql`SELECT id FROM reports WHERE markdown = ${markdown} AND created_at > now() - interval '1 day' ORDER BY id DESC LIMIT 1`;
    if (same.length) { if (delivered) await sql`UPDATE reports SET delivered = true WHERE id = ${same[0].id}`; return same[0].id; }
    const rows = await sql`INSERT INTO reports (kind, title, match_key, markdown, delivered)
      VALUES (${kind}, ${title}, ${matchKey || null}, ${markdown}, ${!!delivered}) RETURNING id`;
    return rows[0]?.id ?? null;
  } catch (e) { console.error("db saveReport:", e.message); return null; }
}

export async function listReports(limit = 30) {
  if (!(await ensure())) return [];
  return sql`SELECT id, kind, title, match_key, delivered, created_at FROM reports ORDER BY created_at DESC LIMIT ${limit}`;
}

export async function getReport(id) {
  if (!(await ensure())) return null;
  const rows = await sql`SELECT id, kind, title, match_key, markdown, delivered, created_at FROM reports WHERE id = ${id}`;
  return rows[0] || null;
}
