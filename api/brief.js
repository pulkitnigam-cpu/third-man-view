// POST /api/brief  { context, mode?: "brief" | "newsletter" }
//   brief      -> { brief, model, searched }      structured pre-match brief
//   newsletter -> { newsletter, model, searched }  a full Markdown edition in Arjun's voice
// Step 1 looks up the pitch report and team news with Google Search; step 2 writes from our data plus those notes.
import { gemini, MODEL, HOUSE_RULES, readBody } from "./_gemini.js";

const S = (description) => ({ type: "STRING", description });
const LIST = (items, description) => ({ type: "ARRAY", items, description });
const PLAYER_NOTES = (key) => LIST({ type: "OBJECT", properties: { player: S("player name exactly as given"), [key]: S("one line") }, required: ["player", key] });
const FORM_NOTES = LIST({ type: "OBJECT", properties: { player: S("player name exactly as given"), inXI: { type: "BOOLEAN" }, note: S("one line on last-5 form with the numbers") }, required: ["player", "inXI", "note"] }, "every squad player");
const SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: S("Punchy newsletter headline, max 12 words"),
    lede: S("2-3 sentence opening that sets up the match using the numbers"),
    headToHead: LIST(S("one stat-led line"), "3-5 head-to-head takeaways"),
    venueTrends: LIST(S("one line"), "exactly the three most relevant venue trends"),
    conditions: S("forecast and what it means for the toss and the game, 1-2 sentences"),
    pitchReport: S("pitch report and team news from DATA.pitchReport and the search notes (quote the curator if quoted), or empty if none"),
    formA: FORM_NOTES, formB: FORM_NOTES,
    xiA: PLAYER_NOTES("reason"), xiB: PLAYER_NOTES("reason"),
    keyMatchups: LIST(S("one line"), "2-4 player battles to watch"),
  },
  required: ["headline", "lede", "headToHead", "venueTrends", "conditions", "formA", "formB", "xiA", "xiB", "keyMatchups"],
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { context: ctx, mode = "brief" } = readBody(req);
  if (!ctx?.match?.codes || JSON.stringify(ctx).length > 250_000) return res.status(400).json({ error: "Bad context" });
  const [A, B] = ctx.match.codes;
  const m = ctx.match;

  try {
    // 1. pitch report + team news, grounded in Google Search (best effort). Skipped when the app already
    //    gathered a pitch report (it searched Cricbuzz and the web), which saves a whole Gemini round trip.
    let notes = "", sources = [];
    if (!ctx.pitchReport) try {
      const r = await gemini({
        contents: [{ role: "user", parts: [{ text: `Find the latest pitch/curator report, weather notes and team news (injuries, likely changes, squad announcements) for the ${m.format} between ${m.teamA} and ${m.teamB}${m.venue ? ` at ${m.venue}, ${m.city}` : ""}${m.startLocal ? ` starting ${m.startLocal}` : ""}${m.series ? ` (${m.series})` : ""}. Reply in under 120 words of plain facts. If you find nothing specific to this match, reply exactly NONE.` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 },
      });
      notes = /^NONE\.?$/i.test(r.text) ? "" : r.text;
      sources = r.sources;
    } catch (e) { if (e.status === 503) throw e; /* search is optional */ }

    const data = `DATA:\n${JSON.stringify(ctx)}\n\nSEARCH NOTES:\n${notes || "None found."}`;

    // 2a. full newsletter edition
    if (mode === "newsletter") {
      const r = await gemini({
        systemInstruction: { parts: [{ text: HOUSE_RULES }] },
        contents: [{ role: "user", parts: [{ text: `Write tonight's Third Man View edition for ${m.teamA} v ${m.teamB} (${m.format}${m.venue ? `, ${m.venue}` : ""}). It goes out the evening before the match.
Format: Markdown, 500-700 words. Structure:
# headline
A two-sentence hook.
## The story so far   (head-to-head, recent meetings, what has changed)
## The ground and the conditions   (exactly three venue trends as a numbered list, then the forecast and what it means for the toss)
## Form guide   (a short paragraph per side naming the in-form and out-of-form players, with numbers)
## Predicted XIs   (two numbered lists in batting order, a few words of reasoning each)
## Battles to watch   (2-3 bullets from the batter-v-bowler data)
## The call   (who has the edge and why, referencing the model's win probability; one line on a player to back)
Write like a sharp human columnist, not a report. Every number must come from DATA.

${data}` }] }],
        generationConfig: { temperature: 0.7 },
      });
      res.setHeader("cache-control", "no-store");
      return res.status(200).json({ newsletter: r.text, sources, model: r.model || MODEL, searched: !!notes });
    }

    // 2b. structured brief
    const r = await gemini({
      systemInstruction: { parts: [{ text: HOUSE_RULES }] },
      contents: [{ role: "user", parts: [{ text: `Write the pre-match brief.
- formA/xiA are for ${m.teamA} (${A}); formB/xiB are for ${m.teamB} (${B}).
- formA/formB: one line for EVERY player in DATA.squads for that side (predicted XI first, then the rest), summarising last-5 form with the numbers; set inXI from DATA. Players with no recent innings get "No recent ${m.format}s in the data".
- xiA/xiB: the predicted XI from DATA in batting order; swap a player only if SEARCH NOTES report an injury or confirmed change, and say so in the reason. One-line reason each.
- venueTrends: exactly three, the most relevant for this match.

${data}` }] }],
      generationConfig: { temperature: 0.5, responseMimeType: "application/json", responseSchema: SCHEMA },
    });
    const out = JSON.parse(r.text);
    const brief = {
      headline: out.headline, lede: out.lede, headToHead: out.headToHead, venueTrends: (out.venueTrends || []).slice(0, 3),
      conditions: out.conditions, pitchReport: out.pitchReport || notes || ctx.pitchReport?.summary || ctx.pitchReport?.seriesPattern || null,
      form: { [A]: out.formA, [B]: out.formB }, predictedXI: { [A]: out.xiA, [B]: out.xiB },
      keyMatchups: out.keyMatchups, sources,
    };
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ brief, model: r.model || MODEL, searched: !!notes });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e) });
  }
}
