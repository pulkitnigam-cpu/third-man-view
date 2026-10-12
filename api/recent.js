// GET /api/recent?a=IND&b=WI&fmt=T20I&since=2026-10-06 -> { matches: [...] }
// Matches the Cricsheet archive doesn't have yet: both sides' recent results from Cricbuzz, with scorecards.
// Results cost 1 request per team (cached 6 h); each scorecard 1 request once (cached 30 days).
import { cbResults, cbScorecard, CB_TEAM } from "./_cricbuzz.js";

// "India won by 14 runs" / "West Indies won by 6 wkts" / "Match tied" / "No result"
function outcome(status, a, b, names) {
  const m = status.match(/^(.+?) won by (.+)$/i);
  if (m) { const w = [a, b].find((c) => names[c] && m[1].toLowerCase().startsWith(names[c].toLowerCase())) || (m[1].toLowerCase().includes("india") ? "IND" : null); return { res: "W", w, by: m[2].replace(/wickets?/i, "wkts") }; }
  if (/tied/i.test(status)) return { res: "T", w: null, by: "" };
  if (/drawn|draw/i.test(status)) return { res: "D", w: null, by: "" };
  return { res: "NR", w: null, by: "" };
}

export default async function handler(req, res) {
  const q = (k) => String(req.query?.[k] || new URL(req.url, "http://x").searchParams.get(k) || "").trim();
  const a = q("a"), b = q("b"), fmt = q("fmt"), since = q("since") || "1970-01-01";
  const names = { [a]: q("an") || a, [b]: q("bn") || b };
  if (!process.env.RAPIDAPI_KEY) return res.status(200).json({ matches: [], configured: false });
  try {
    const seen = new Map();
    const lists = await Promise.all([a, b].map((t) => (CB_TEAM[t] ? cbResults(t).catch(() => []) : [])));
    for (const res of lists) {
      for (const m of res) if (m.d > since && (!fmt || m.fmt === fmt) && !seen.has(m.cbMatch)) seen.set(m.cbMatch, m);
    }
    const list = [...seen.values()].sort((x, y) => x.d.localeCompare(y.d)).slice(-8);
    const matches = [];
    const cards = await Promise.all(list.map((m) => cbScorecard(m.cbMatch).catch(() => null)));
    for (const [k, m] of list.entries()) {
      const sc = cards[k];
      if (!sc) continue;
      const o = outcome(sc.status || m.status, m.a, m.b, { [m.a]: names[m.a] || m.a, [m.b]: names[m.b] || m.b });
      // host from "X tour of Y": the touring side is X
      const tour = (m.series || "").match(/^(.+?) tour of (.+?)(,|\s\d{4}|$)/i);
      // only decide when a side's name is known; an empty name would match every host
      const hostIs = (c) => !!names[c] && tour[2].toLowerCase().startsWith(names[c].toLowerCase());
      matches.push({ ...m, ...o, host: tour ? (hostIs(m.a) ? m.a : hostIs(m.b) ? m.b : null) : null, innings: sc.innings });
    }
    res.setHeader("cache-control", "s-maxage=21600, stale-while-revalidate=43200");
    return res.status(200).json({ matches, source: "cricbuzz" });
  } catch (e) {
    return res.status(200).json({ matches: [], error: String(e.message || e) });
  }
}
