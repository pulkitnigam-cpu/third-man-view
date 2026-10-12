// GET /api/fixtures -> { fixtures: [...], source }  real upcoming senior men's internationals
// Sources in order: CricketData.org, then Cricbuzz (India's schedule), then Gemini Flash + Google Search.
// ?source=cricbuzz or ?source=backup forces a later source (for testing).
// India's series (via series search -> series_info) plus whatever other internationals are on now (currentMatches).
// ~4-6 CricketData hits per refresh; the CDN keeps the result for 3 hours.
import { cricapi, toFixture, isSenior, CODES } from "./_cricapi.js";
import { backupFixtures, normFormat } from "./_backup.js";
import { cbSchedule } from "./_cricbuzz.js";

const DAY = 864e5;
// series list dates come as "2026-10-22" or "Oct 24"; borrow the year from the series name when it's missing
function seriesDate(s, name, fallback) {
  if (!s) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s);
  const y = (name.match(/20\d\d/g) || []).map(Number);
  const d = Date.parse(`${s} ${y[0] || new Date().getFullYear()}`);
  return Number.isNaN(d) ? fallback : d;
}
const labelOf = (m) => { const p = (m.name || "").split(",").map((x) => x.trim()); return [p.slice(2).join(" "), p[1]].filter(Boolean).join(" · "); };

async function fromBackup() {
  const { items, sources } = await backupFixtures();
  const code = (n) => CODES[n] || CODES[String(n).replace(/ (men|cricket team)$/i, "")] || n;
  const fixtures = items.map((m) => {
    const start = Date.parse(m.startUtc), fmt = normFormat(m.format);
    if (!fmt || Number.isNaN(start)) return null;
    const a = code(m.teamA), b = code(m.teamB);
    return { id: "g-" + [a, b, fmt, m.startUtc].join("-").replace(/[^A-Za-z0-9-]/g, ""), a, b, fmt, series: [m.series, m.match].filter(Boolean).join(" · "),
      venueName: [m.venue, m.city].filter(Boolean).join(", "), start: new Date(start).toISOString(), live: true, src: "backup" };
  }).filter((x) => x && Date.parse(x.start) > Date.now() - 5 * DAY).sort((x, y) => x.start.localeCompare(y.start));
  return { fixtures, sources };
}

export default async function handler(req, res) {
  const source = req.query?.source || new URL(req.url, "http://x").searchParams.get("source") || "";
  const forceBackup = source === "backup" || source === "cricbuzz";
  const backup = async (why) => {
    // second source: Cricbuzz (1 request, cached 6 h)
    if (process.env.RAPIDAPI_KEY && source !== "backup") {
      try {
        const fx = (await cbSchedule("IND")).filter((x) => Date.parse(x.start) <= Date.now() + 45 * DAY && Date.parse(x.start) >= Date.now() - DAY);
        if (fx.length) { res.setHeader("cache-control", "s-maxage=21600, stale-while-revalidate=43200"); return res.status(200).json({ fixtures: fx, source: "cricbuzz", why }); }
      } catch (e) { why += `; Cricbuzz failed: ${e.message}`; }
    }
    try {
      const b = await fromBackup();
      res.setHeader("cache-control", "s-maxage=21600, stale-while-revalidate=43200");
      return res.status(200).json({ fixtures: b.fixtures, source: "backup", why, sources: b.sources });
    } catch (e) { return res.status(200).json({ fixtures: [], source: "none", why: `${why}; backup failed: ${e.message}` }); }
  };
  if (forceBackup) return backup("forced");
  if (!process.env.CRICAPI_KEY) return backup("CRICAPI_KEY is not set");
  try {
    const now = Date.now();
    const out = new Map();
    // 1. India's senior series that are on now or start within ~6 weeks
    const series = (await cricapi("series", { offset: 0, search: "India" })).data || [];
    const pick = series.filter((s) => isSenior(s.name) && /tour of|vs |cup|trophy|series/i.test(s.name)).filter((s) => {
      const start = seriesDate(s.startDate, s.name, now), end = seriesDate(s.endDate, s.name, start);
      const endFix = end < start ? end + 365 * DAY : end; // "Dec 27" after a "2026-12-13" start, etc.
      return endFix >= now - DAY && start <= now + 45 * DAY;
    }).slice(0, 4);
    for (const s of pick) {
      const info = await cricapi("series_info", { id: s.id });
      for (const m of info.data?.matchList || []) {
        const f = toFixture(m);
        if (!f || m.matchEnded || Date.parse(f.start) > now + 45 * DAY) continue;
        f.series = labelOf(m) || s.name; f.sid = s.id;
        out.set(f.id, f);
      }
    }
    // 2. other internationals happening now (one call)
    try {
      for (const m of (await cricapi("currentMatches", { offset: 0 }, 1800)).data || []) {
        if (m.matchEnded || !isSenior(m.name || "") || !/T20I|ODI|Test/i.test(m.name || "")) continue;
        const f = toFixture(m); if (f) { f.series = labelOf(m); out.set(f.id, f); }
      }
    } catch { /* optional */ }
    const fixtures = [...out.values()].sort((x, y) => x.start.localeCompare(y.start)).slice(0, 20);
    if (!fixtures.length) return backup("CricketData returned no fixtures");
    res.setHeader("cache-control", "s-maxage=10800, stale-while-revalidate=21600");
    return res.status(200).json({ fixtures, source: "cricketdata" });
  } catch (e) {
    return backup(`CricketData failed: ${e.message}`);
  }
}
