// GET /api/match?id=<CricketData match id> -> { fixture }   look a match up by its ID (1 hit, cached 3 h)
import { cricapi, toFixture } from "./_cricapi.js";

export default async function handler(req, res) {
  const id = String(req.query?.id || new URL(req.url, "http://x").searchParams.get("id") || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Match IDs look like 3c451481-9fa8-400b-a7b6-27cffc21e1a8" });
  try {
    const m = (await cricapi("match_info", { id })).data;
    const f = m && toFixture(m);
    if (!f) return res.status(404).json({ error: "No international match with that ID" });
    const p = (m.name || "").split(",").map((x) => x.trim());
    f.series = [p.slice(2).join(" "), p[1]].filter(Boolean).join(" · ");
    res.setHeader("cache-control", "s-maxage=10800, stale-while-revalidate=21600");
    return res.status(200).json({ fixture: f });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e) });
  }
}
