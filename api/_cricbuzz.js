// Cricbuzz (RapidAPI, free BASIC plan: 200 requests a month). Used sparingly: India's schedule as a fixtures backup,
// and format-specific series squads (the most precise squad source). Everything is cached; 204 means "no data".
import { cacheGet, cacheSet } from "./_db.js";
const HOST = "cricbuzz-cricket.p.rapidapi.com";
const mem = new Map();

export async function cb(path, ttlSec = 6 * 3600) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw Object.assign(new Error("RAPIDAPI_KEY is not set"), { status: 503 });
  const hit = mem.get(path);
  if (hit && hit.until > Date.now()) return hit.data;
  // shared cache in Neon, so other function instances don't spend the monthly allowance again
  const shared = await cacheGet("cb:" + path);
  if (shared !== undefined) { mem.set(path, { data: shared, until: Date.now() + Math.min(ttlSec, 3600) * 1000 }); return shared; }
  const r = await fetch(`https://${HOST}/${path}`, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST }, signal: AbortSignal.timeout(15000) });
  if (r.status === 204) { mem.set(path, { data: null, until: Date.now() + ttlSec * 1000 }); await cacheSet("cb:" + path, null, ttlSec); return null; }
  if (!r.ok) throw Object.assign(new Error(`Cricbuzz ${r.status}`), { status: 502 });
  const data = await r.json();
  mem.set(path, { data, until: Date.now() + ttlSec * 1000 });
  await cacheSet("cb:" + path, data, ttlSec);
  return data;
}

// Cricbuzz team ids for schedules (India = 2, West Indies = 10 are confirmed from live responses)
export const CB_TEAM = { IND: 2, PAK: 3, AUS: 4, SL: 5, BAN: 6, ENG: 9, WI: 10, SA: 11, ZIM: 12, NZ: 13, IRE: 27, AFG: 96 };
const FMT = { T20: "T20I", ODI: "ODI", TEST: "Test" };
const SHORT = { NZ: "NZ", IND: "IND", WI: "WI", SL: "SL", ZIM: "ZIM", AUS: "AUS", ENG: "ENG", SA: "SA", RSA: "SA", PAK: "PAK", BAN: "BAN", AFG: "AFG", IRE: "IRE", UAE: "UAE" };

// A team's upcoming senior internationals, as fixtures (1 request, cached 6 h)
export async function cbSchedule(team = "IND") {
  const id = CB_TEAM[team];
  if (!id) return [];
  const j = await cb(`teams/v1/${id}/schedule`);
  const out = [];
  for (const day of j?.teamMatchesData || []) for (const m of day.matchDetailsMap?.match || []) {
    const i = m.matchInfo, fmt = FMT[i.matchFormat];
    if (!fmt || /sixes|legends|masters|women|u19|\bA\b/i.test(i.seriesName || "")) continue;
    const a = SHORT[i.team1?.teamSName] || i.team1?.teamSName, b = SHORT[i.team2?.teamSName] || i.team2?.teamSName;
    if (!a || !b || /TBC/i.test(a + b)) continue;
    out.push({
      id: "cb-" + i.matchId, cbMatch: i.matchId, cbSeries: i.seriesId, a, b, fmt,
      series: `${i.seriesName.replace(/,\s*(\d{4})$/, " $1")} · ${i.matchDesc}`,
      venueName: [i.venueInfo?.ground, i.venueInfo?.city].filter(Boolean).join(", "),
      start: new Date(+i.startDate).toISOString(), live: true, src: "cricbuzz",
    });
  }
  return out;
}

// The announced squads for a match's series in that format: find the series from either side's schedule,
// then read the "<Team> T20I Squad" entries (about 4 requests, cached 24 h).
export async function cbSquad({ a, b, fmt, start }) {
  const t = Date.parse(start || "");
  let match = null;
  for (const team of [a, b]) {
    if (!CB_TEAM[team]) continue;
    const list = await cbSchedule(team);
    match = list.find((m) => [m.a, m.b].includes(a) && [m.a, m.b].includes(b) && m.fmt === fmt && (!t || Math.abs(Date.parse(m.start) - t) < 2 * 864e5));
    if (match) break;
  }
  if (!match) return null;
  const sq = await cb(`series/v1/${match.cbSeries}/squads`, 24 * 3600);
  const label = { T20I: /T20/i, ODI: /ODI/i, Test: /Test/i }[fmt];
  // both squads in parallel
  const wanted = (sq?.squads || []).filter((s) => !s.isHeader && label.test(s.squadType));
  const teams = await Promise.all(wanted.map(async (s) => {
    const players = (await cb(`series/v1/${match.cbSeries}/squads/${s.squadId}`, 24 * 3600))?.player || [];
    return { name: s.squadType.replace(/\s+(T20I?|ODI|Test)\s+Squad$/i, ""), players: players.filter((p) => !p.isHeader).map((p) => ({ name: p.name, role: p.role || null, bat: p.battingStyle || null, bowl: p.bowlingStyle || null, captain: !!p.captain })) };
  }));
  return teams.length ? teams : null;
}

// Series news (1 request, cached 12 h) and full stories (1 request each, cached 7 days) as plain text.
export async function cbSeriesNews(seriesId) {
  const j = await cb(`news/v1/series/${seriesId}`, 12 * 3600);
  return (j?.storyList || []).map((s) => s.story).filter(Boolean).map((s) => ({ id: s.id, headline: s.hline, intro: s.intro || "", at: new Date(+s.pubTime).toISOString() }));
}
export async function cbStory(id) {
  const j = await cb(`news/v1/detail/${id}`, 7 * 24 * 3600);
  const text = (j?.content || []).map((c) => c.content?.contentValue).filter(Boolean).join("\n").replace(/<[^>]+>/g, "").trim();
  return text ? { id, headline: j.headline, at: new Date(+j.publishTime).toISOString(), text, url: `https://www.cricbuzz.com/cricket-news/${id}` } : null;
}
// Find a fixture on Cricbuzz from either team's schedule (cached), so other calls can use its match and series ids.
export async function cbFind({ a, b, fmt, start }) {
  const t = Date.parse(start || "");
  for (const team of [a, b]) {
    if (!CB_TEAM[team]) continue;
    const m = (await cbSchedule(team)).find((x) => [x.a, x.b].includes(a) && [x.a, x.b].includes(b) && x.fmt === fmt && (!t || Math.abs(Date.parse(x.start) - t) < 2 * 864e5));
    if (m) return m;
  }
  return null;
}

// A team's recent senior internationals (1 request, cached 6 h)
export async function cbResults(team) {
  const id = CB_TEAM[team];
  if (!id) return [];
  const j = await cb(`teams/v1/${id}/results`);
  const out = [];
  for (const day of j?.teamMatchesData || []) for (const m of day.matchDetailsMap?.match || []) {
    const i = m.matchInfo, fmt = FMT[i.matchFormat];
    if (!fmt || /sixes|legends|masters|women|u19|\bA\b|asian games|olympic/i.test(i.seriesName || "")) continue;
    out.push({ cbMatch: i.matchId, fmt, d: new Date(+i.startDate).toISOString().slice(0, 10), a: SHORT[i.team1?.teamSName] || i.team1?.teamSName, b: SHORT[i.team2?.teamSName] || i.team2?.teamSName,
      series: i.seriesName, desc: i.matchDesc, status: i.status || "", venue: [i.venueInfo?.ground, i.venueInfo?.city].filter(Boolean).join(", ") });
  }
  return out;
}
// A finished match's scorecard (1 request, cached 30 days: results don't change)
export async function cbScorecard(matchId) {
  const j = await cb(`mcenter/v1/${matchId}/scard`, 30 * 24 * 3600);
  if (!j?.scorecard?.length) return null;
  return {
    status: j.status || "",
    innings: j.scorecard.map((s) => ({
      // everyone listed, including those who did not bat, so appearances count correctly
      xi: (s.batsman || []).map((b) => b.name),
      team: SHORT[s.batteamsname] || s.batteamsname, r: +s.score || 0, w: +s.wickets || 0, ov: String(s.overs ?? ""), dec: !!s.isdeclared,
      bat: (s.batsman || []).map((b, k) => ({ name: b.name, r: +b.runs || 0, b: +b.balls || 0, f: +b.fours || 0, s: +b.sixes || 0, out: !!b.outdec && !/not out/i.test(b.outdec), how: b.outdec || "not out", pos: k + 1 }))
        .filter((b) => b.b > 0 || b.out),
      bowl: (s.bowler || []).map((b) => ({ name: b.name, ov: String(b.overs ?? ""), md: +b.maidens || 0, r: +b.runs || 0, w: +b.wickets || 0 })),
    })),
  };
}
