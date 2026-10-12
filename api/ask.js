// POST /api/ask  { context, question, history?: [{role:"user"|"model", text}] }  ->  { answer, sources, model }
// "Ask Third Man": free-form questions about the match, answered from the dossier data first, Google Search second.
import { gemini, MODEL, HOUSE_RULES, readBody } from "./_gemini.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { context: ctx, question, history = [] } = readBody(req);
  const q = String(question || "").trim().slice(0, 600);
  if (!q || !ctx?.match || JSON.stringify(ctx).length > 250_000) return res.status(400).json({ error: "Bad request" });
  const m = ctx.match;
  const turns = history.slice(-8).filter((t) => t && (t.role === "user" || t.role === "model") && t.text).map((t) => ({ role: t.role, parts: [{ text: String(t.text).slice(0, 2000) }] }));
  try {
    const r = await gemini({
      systemInstruction: { parts: [{ text: `${HOUSE_RULES}
You are answering Arjun's questions while he prepares the ${m.teamA} v ${m.teamB} ${m.format}${m.venue ? ` at ${m.venue}` : ""}.
Answer in at most 120 words. Lead with the answer, then the two or three numbers that back it. Use short bullets only if listing.
If DATA doesn't cover it and search finds nothing reliable, say so plainly.

DATA:
${JSON.stringify(ctx)}` }] },
      contents: [...turns, { role: "user", parts: [{ text: q }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4 },
    });
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ answer: r.text, sources: r.sources, model: r.model || MODEL });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e) });
  }
}
