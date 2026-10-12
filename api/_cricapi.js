// CricketData.org (cricapi) helpers. Free plan: 100 "hits" a day; match_squad costs ~10, list calls ~1.
// Responses are cached in memory for the life of a warm function, and every endpoint sets CDN cache headers.
import { cacheGet, cacheSet } from "./_db.js";
const BASE = "https://api.cricapi.com/v1/";
const mem = new Map();

export async function cricapi(path, params = {}, ttlSec = 3 * 3600) {
  const key = process.env.CRICAPI_KEY;
  if (!key) throw Object.assign(new Error("CRICAPI_KEY is not set"), { status: 503 });
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const ck = path + "?" + new URLSearchParams(params).toString();
  const hit = mem.get(ck);
  if (hit && hit.until > Date.now()) return hit.data;
  const shared = await cacheGet("ca:" + ck); // shared cache in Neon: the daily allowance is small
  if (shared !== undefined) { mem.set(ck, { data: shared, until: Date.now() + Math.min(ttlSec, 3600) * 1000 }); return shared; }
  const r = await fetch(BASE + path + "?" + qs, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (j.status !== "success") throw Object.assign(new Error(j.reason || `CricketData ${r.status}`), { status: 502 });
  mem.set(ck, { data: j, until: Date.now() + ttlSec * 1000 });
  await cacheSet("ca:" + ck, j, ttlSec);
  return j;
}

export const CODES = {
  India: "IND", Australia: "AUS", England: "ENG", "New Zealand": "NZ", "South Africa": "SA", Pakistan: "PAK", "Sri Lanka": "SL",
  Bangladesh: "BAN", "West Indies": "WI", Afghanistan: "AFG", Zimbabwe: "ZIM", Ireland: "IRE", "United Arab Emirates": "UAE",
  Scotland: "SCO", Netherlands: "NED", Nepal: "NEP", Namibia: "NAM", Oman: "OMA", "United States of America": "USA", USA: "USA",
  Canada: "CAN", "Papua New Guinea": "PNG", "Hong Kong": "HK", Kenya: "KEN", Uganda: "UGA",
};

// matchType from the API is unreliable (T20Is come back as "odi"), so read the format from the match name.
export function formatOf(m) {
  const n = m.name || "";
  if (/\bT20I?\b|T20 World Cup/i.test(n)) return "T20I";
  if (/\bTest\b/i.test(n)) return "Test";
  if (/\bODI\b|World Cup/i.test(n)) return "ODI";
  return { t20: "T20I", odi: "ODI", test: "Test" }[m.matchType] || null;
}

// Senior men's internationals only.
export const isSenior = (name) => !/women|u19|u-19|under.?19|\bA tour\b| A tour|\bA vs\b|legends|league|premier|division|masters|district|county|trophy \d|ranji|duleep|super smash|shield|sheffield|plunket|qualifier [a-z]|sub regional|emerging|academy|xi\b/i.test(name);

export function toFixture(m, series = "") {
  const [a, b] = (m.teamInfo?.length ? m.teamInfo.map((t) => t.name) : m.teams || []).map((t) => CODES[t] || t);
  const fmt = formatOf(m);
  if (!a || !b || !fmt || !m.dateTimeGMT) return null;
  return {
    id: m.id, a, b, fmt,
    series: (m.name || "").split(",").slice(1).reverse().map((s) => s.trim()).join(" · ") || series,
    venueName: m.venue || "", start: new Date(m.dateTimeGMT + "Z").toISOString(),
    apiStatus: m.status || "", started: !!m.matchStarted, ended: !!m.matchEnded, hasSquad: m.hasSquad !== false, live: true,
  };
}
