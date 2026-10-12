// GET /api/squad?id=&a=&b=&ca=&cb=&fmt=&series=&start= -> { teams: [{ code, name, players: [{ name, role, bat, bowl, type }] }], source }
// Announced squads, best source first: Cricbuzz (the exact squad for this format, ~4 requests a series),
// CricketData.org (the combined tour squad, ~10 hits), then Gemini + Google Search. Cached 12-24 h.
import { cricapi, CODES } from "./_cricapi.js";
import { backupSquad } from "./_backup.js";
import { cbSquad } from "./_cricbuzz.js";

// "Right-arm fast-medium" -> pace, "Right-arm offbreak" / "Slow left-arm orthodox" / "Legbreak googly" -> spin
const bowlType = (s = "") => (!s ? null : /off.?break|leg.?break|googly|orthodox|chinaman|wrist|slow left|spin/i.test(s) ? "spin" : /fast|medium|seam|pace/i.test(s) ? "pace" : null);

export default async function handler(req, res) {
  const q = (k) => String(req.query?.[k] || new URL(req.url, "http://x").searchParams.get(k) || "").trim();
  const id = q("id"), names = { a: q("a"), b: q("b"), fmt: q("fmt"), series: q("series") }, codes = { a: q("ca"), b: q("cb") };
  const src = q("source");
  // 1. Cricbuzz: format-specific series squads
  if (process.env.RAPIDAPI_KEY && codes.a && codes.b && !["cricketdata", "backup"].includes(src)) {
    try {
      const t = await cbSquad({ a: codes.a, b: codes.b, fmt: names.fmt, start: q("start") });
      if (t?.some((x) => x.players.length >= 11)) {
        const teams = t.map((x) => ({ code: CODES[x.name] || x.name, name: x.name, players: x.players.map((p) => ({ ...p, type: bowlType(p.bowl) })) }));
        res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=172800");
        return res.status(200).json({ teams, source: "cricbuzz" });
      }
    } catch { /* fall through to CricketData */ }
  }
  // backup: Gemini + Google Search, needs team names
  const backup = async (why) => {
    if (!names.a || !names.b) return res.status(502).json({ error: why });
    try {
      const r = await backupSquad(names);
      const teams = r.teams.map((t) => ({ code: CODES[t.team] || t.team, name: t.team, players: (t.players || []).map((p) => ({ name: p.name, role: p.role || null, bat: null, bowl: p.bowlingStyle || null, type: bowlType(p.bowlingStyle) })) }));
      if (!teams.some((t) => t.players.length >= 11)) return res.status(404).json({ error: "No announced squad found" });
      res.setHeader("cache-control", "s-maxage=43200, stale-while-revalidate=86400");
      return res.status(200).json({ teams, source: "backup", sources: r.sources });
    } catch (e) { return res.status(502).json({ error: `${why}; backup failed: ${e.message}` }); }
  };
  if (src === "backup" || !/^[0-9a-f-]{36}$/i.test(id) || !process.env.CRICAPI_KEY) return backup("No CricketData match id");
  try {
    const data = (await cricapi("match_squad", { id }, 12 * 3600)).data || [];
    const teams = data.map((t) => ({
      code: CODES[t.teamName] || t.shortname || t.teamName, name: t.teamName,
      players: (t.players || []).map((p) => ({ name: p.name, role: p.role || null, bat: p.battingStyle || null, bowl: p.bowlingStyle || null, type: bowlType(p.bowlingStyle) })),
    }));
    if (!teams.some((t) => t.players.length)) return backup("CricketData has no squad yet");
    res.setHeader("cache-control", "s-maxage=43200, stale-while-revalidate=86400");
    return res.status(200).json({ teams, source: "cricketdata" });
  } catch (e) {
    return backup(`CricketData failed: ${e.message}`);
  }
}
