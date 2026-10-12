// GET /api/pitch?a=&b=&ca=&cb=&fmt=&start=&venue=&city= -> { report, notes: [{kind, title, url, at}], source }
// The pitch curator's report. No API publishes these as data, so it is assembled from:
//   1. Cricbuzz's pitch note (selected major matches, close to match day)
//   2. Cricbuzz series news: the match preview and stories about pitches, dew and conditions
//   3. Google Search via Gemini, when the daily search allowance remains
// then plain Gemini Flash (no search needed) writes a structured report from those notes only.
// Cached 6 h; empty answers are not cached.
import { gemini } from "./_gemini.js";
import { cb, cbFind, cbSeriesNews, cbStory } from "./_cricbuzz.js";
import { cacheGet, cacheSet } from "./_db.js";

const mem = new Map();
const SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN", description: "true if the notes say anything about this match's pitch or the pitches in this series" },
    summary: { type: "STRING", description: "2-3 sentences: what the surface is expected to do for THIS match, in plain English; empty if nothing is known" },
    seriesPattern: { type: "STRING", description: "what pitches and conditions have been like earlier in this series, if the notes say; else empty" },
    surface: { type: "STRING", description: "e.g. 'flat, true bounce', 'dry, likely to turn'; empty if unknown" },
    favours: { type: "STRING", enum: ["batting", "pace", "spin", "balanced", "unknown"] },
    expectedScore: { type: "STRING", description: "par or expected first-innings score if stated, else empty" },
    dew: { type: "STRING", description: "what is said about dew or the toss, else empty" },
    teamNews: { type: "STRING", description: "injuries, withdrawals or likely changes to either XI mentioned in the notes, else empty" },
    quotes: { type: "ARRAY", items: { type: "OBJECT", properties: { text: { type: "STRING" }, who: { type: "STRING" }, outlet: { type: "STRING" } }, required: ["text", "who"] } },
  },
  required: ["found", "summary", "favours"],
};
const PITCHY = /pitch|wicket|surface|curator|groundsman|conditions|dew|track|deck|preview|brace|eye|aim|face|run-fest|toss/i;

export default async function handler(req, res) {
  const q = (k) => String(req.query?.[k] || new URL(req.url, "http://x").searchParams.get(k) || "").trim();
  const p = { a: q("a"), b: q("b"), ca: q("ca"), cbc: q("cb"), fmt: q("fmt"), start: q("start"), venue: q("venue"), city: q("city") };
  if (!p.a || !p.b || !p.venue) return res.status(400).json({ error: "Need teams and venue" });
  const key = JSON.stringify(p);
  const hit = mem.get(key);
  if (hit && hit.until > Date.now()) return res.status(200).json(hit.data);
  const shared = await cacheGet("pitch:" + key);
  if (shared) { mem.set(key, { data: shared, until: Date.now() + 3600 * 1000 }); return res.status(200).json(shared); }
  const notes = [], texts = [];
  try {
    // Cricbuzz and Google Search run at the same time; within Cricbuzz, the pitch note and the stories load in parallel.
    const fromCricbuzz = async () => {
      if (!process.env.RAPIDAPI_KEY || !p.ca || !p.cbc) return [];
      const m = await cbFind({ a: p.ca, b: p.cbc, fmt: p.fmt, start: p.start });
      if (!m) return [];
      const [v, news] = await Promise.all([cb(`forecast/v1/venueInfo/${m.cbMatch}`, 6 * 3600).catch(() => null), cbSeriesNews(m.cbSeries).catch(() => [])]);
      const picked = news.filter((x) => PITCHY.test(x.headline + " " + x.intro) || (p.city && (x.headline + x.intro).includes(p.city))).slice(0, 3);
      const stories = await Promise.all(picked.map((x) => cbStory(x.id).catch(() => null)));
      const out = [];
      if (v) out.push({ text: `CRICBUZZ PITCH NOTE:
${JSON.stringify(v).slice(0, 3000)}`, note: { kind: "Cricbuzz pitch note", title: "Venue and pitch", url: `https://www.cricbuzz.com/live-cricket-scores/${m.cbMatch}` } });
      for (const st of stories.filter(Boolean)) out.push({ text: `CRICBUZZ (${st.at.slice(0, 10)}) "${st.headline}":
${st.text.slice(0, 4000)}`, note: { kind: "Cricbuzz", title: st.headline, url: st.url, at: st.at.slice(0, 10) } });
      return out;
    };
    const fromSearch = async () => {
      const day = (p.start || "").slice(0, 10);
      const found = await gemini({
        contents: [{ role: "user", parts: [{ text: `Find the latest pitch report and team news for the ${p.fmt} between ${p.a} and ${p.b} at ${p.venue}${p.city ? `, ${p.city}` : ""}${day ? ` on ${day}` : ""}: what the curator, groundstaff, captains or coaches said about the surface, the expected score, dew or the toss, plus injuries and likely changes to either XI. Include direct quotes with who said them and the outlet. Plain notes with dates, or NONE if nothing specific has been published.` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 },
      });
      if (!found.text || /^NONE.?$/i.test(found.text.trim())) return [];
      return [{ text: `WEB SEARCH NOTES:
${found.text}`, notes: found.sources.map((x) => ({ kind: "Web", title: x.title, url: x.url })) }];
    };
    const [cbr, web] = await Promise.all([fromCricbuzz().catch(() => []), fromSearch().catch(() => [])]);
    for (const x of [...cbr, ...web]) { texts.push(x.text); if (x.note) notes.push(x.note); if (x.notes) notes.push(...x.notes); }

    let report = null;
    if (texts.length) {
      const out = await gemini({
        contents: [{ role: "user", parts: [{ text: `Write a pitch report for ${p.a} v ${p.b} (${p.fmt}) at ${p.venue}${p.city ? `, ${p.city}` : ""}${p.start ? ` on ${p.start.slice(0, 10)}` : ""}.
Use ONLY these notes. Keep quotes word for word, with who said them and the outlet.
Separate what is said about THIS match and ground (summary, surface, expectedScore, dew) from what pitches have been like earlier in the series at other grounds (seriesPattern). If nothing is said about this ground, leave summary empty and favours "unknown".

${texts.join("\n\n")}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: SCHEMA },
      });
      report = JSON.parse(out.text || "null");
      if (report && !report.found) report = null;
    }
    const data = { report, notes, source: notes.some((n) => n.kind === "Web") ? "cricbuzz+search" : notes.length ? "cricbuzz" : "none" };
    if (report) { mem.set(key, { data, until: Date.now() + 6 * 3600 * 1000 }); await cacheSet("pitch:" + key, data, 6 * 3600); }
    res.setHeader("cache-control", report ? "s-maxage=21600, stale-while-revalidate=43200" : "no-store");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e), notes });
  }
}
