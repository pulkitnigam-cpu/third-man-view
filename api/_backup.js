// Backup data source: Gemini Flash with Google Search grounding. Used when CricketData.org fails or runs out of
// daily requests. Two calls each time: a grounded search, then a schema-constrained call that turns the notes into JSON.
import { gemini } from "./_gemini.js";
import { cacheGet, cacheSet } from "./_db.js";

const mem = new Map();
const cached = async (key, ttlSec, fn) => {
  const h = mem.get(key);
  if (h && h.until > Date.now()) return h.data;
  const shared = await cacheGet("bk:" + key);
  if (shared) { mem.set(key, { data: shared, until: Date.now() + 3600 * 1000 }); return shared; }
  const data = await fn();
  // never remember an empty answer: the next request should try again
  if ((data.items || data.teams || []).length) { mem.set(key, { data, until: Date.now() + ttlSec * 1000 }); await cacheSet("bk:" + key, data, ttlSec); }
  return data;
};

async function searchThenStructure(searchPrompt, schema, structurePrompt) {
  const found = await gemini({ contents: [{ role: "user", parts: [{ text: searchPrompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } });
  if (!found.text || /^NONE\.?$/i.test(found.text)) return { data: null, sources: found.sources };
  const out = await gemini({
    contents: [{ role: "user", parts: [{ text: `${structurePrompt}\nUse only facts in these notes; leave out anything uncertain.\n\nNOTES:\n${found.text}` }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: schema },
  });
  return { data: JSON.parse(out.text || "null"), sources: found.sources };
}

const FMT = { T20I: "T20I", ODI: "ODI", TEST: "Test", Test: "Test", T20: "T20I" };

// Upcoming senior men's internationals for India (and anything big on now), as fixtures.
export function backupFixtures(today = new Date().toISOString().slice(0, 10)) {
  return cached(`fx:${today}`, 6 * 3600, async () => {
    const { data, sources } = await searchThenStructure(
      `Today is ${today}. List every senior men's international cricket match India are scheduled to play in the next 45 days (T20I, ODI, Test), plus any senior men's international match being played today. For each: the two teams, format, match number and series name, venue and city, and start date and time with time zone. Use official schedules (BCCI, ICC, ESPNcricinfo, Cricbuzz). Reply in plain lines, or NONE if you find nothing.`,
      { type: "ARRAY", items: { type: "OBJECT", properties: {
        teamA: { type: "STRING" }, teamB: { type: "STRING" }, format: { type: "STRING", enum: ["T20I", "ODI", "Test"] },
        match: { type: "STRING", description: "e.g. 4th T20I" }, series: { type: "STRING" }, venue: { type: "STRING" }, city: { type: "STRING" },
        startUtc: { type: "STRING", description: "ISO 8601 in UTC, e.g. 2026-10-14T13:30:00Z" },
      }, required: ["teamA", "teamB", "format", "startUtc"] } },
      "Turn these notes into a list of matches.",
    );
    return { items: Array.isArray(data) ? data : [], sources };
  });
}

// The announced squad for a match, with roles and bowling styles where reported.
// One flat row per player: nested team -> players schemas made the model stop after a single player.
export function backupSquad({ a, b, fmt, series }) {
  return cached(`sq:${a}|${b}|${fmt}|${series}`, 12 * 3600, async () => {
    const { data, sources } = await searchThenStructure(
      `Find the latest officially announced ${fmt || ""} squads (senior men) for ${a} and ${b}${series ? ` for the ${series}` : ""}. If a player was withdrawn or replaced, use the updated squad. List every player in each squad with role (batter, wicketkeeper, all-rounder or bowler) and bowling style if known. Reply in plain lines, or NONE if no squad has been announced.`,
      { type: "ARRAY", items: { type: "OBJECT", properties: {
        team: { type: "STRING", enum: [a, b] }, name: { type: "STRING" },
        role: { type: "STRING", enum: ["Batter", "Wicketkeeper", "All-rounder", "Bowler"] }, bowlingStyle: { type: "STRING" },
      }, required: ["team", "name", "role"] } },
      `List every player in the notes as one row each (team, name, role, bowling style). Include both squads in full; leave out withdrawn players.`,
    );
    const rows = Array.isArray(data) ? data : [];
    const teams = [a, b].map((t) => ({ team: t, players: rows.filter((r) => r.team === t).map((r) => ({ name: r.name, role: r.role, bowlingStyle: r.bowlingStyle })) })).filter((t) => t.players.length);
    return { teams, sources };
  });
}

export const normFormat = (f) => FMT[f] || null;
