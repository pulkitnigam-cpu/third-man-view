// POST /api/review  { mode: "report" | "period" | "ask", context, question?, history? }
//   report -> a newsletter match report for one past match (from its scorecard)
//   period -> a review of a set of past matches (e.g. India's T20Is v Australia in 2024)
//   ask    -> a question about either of those
import { gemini, MODEL, HOUSE_RULES, readBody } from "./_gemini.js";

const PROMPTS = {
  report: `Write a Third Man View match report on this past match for the newsletter archive.
Markdown, 350-500 words:
# headline
A two-sentence hook naming the result.
## How it was won   (the decisive phases and partnerships the scorecard shows)
## Standouts   (3-4 bullets: best performers with their figures)
## The numbers that mattered   (3 bullets: phase run rates, extras, dot-heavy spells, toss and conditions)
## What it meant   (one short paragraph: series or rivalry context from DATA, or from search if DATA lacks it)`,
  period: `Write a Third Man View review of this run of matches for the newsletter.
Markdown, 400-600 words:
# headline
## The record   (played, won, lost, where and how)
## Patterns   (3-4 bullets: batting first vs chasing, home vs away, margins, conditions)
## Turning points   (the 2-3 results that defined the period, with scores)
## What to take forward   (one paragraph)`,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { mode = "report", context, question, history = [] } = readBody(req);
  if (!context || JSON.stringify(context).length > 250_000) return res.status(400).json({ error: "Bad context" });
  try {
    if (mode === "ask") {
      const q = String(question || "").trim().slice(0, 600);
      if (!q) return res.status(400).json({ error: "Empty question" });
      const turns = history.slice(-8).filter((t) => t?.text && (t.role === "user" || t.role === "model")).map((t) => ({ role: t.role, parts: [{ text: String(t.text).slice(0, 2000) }] }));
      const r = await gemini({
        systemInstruction: { parts: [{ text: `${HOUSE_RULES}\nYou are answering Arjun's questions about past matches. At most 120 words; lead with the answer, then the numbers that back it.\n\nDATA:\n${JSON.stringify(context)}` }] },
        contents: [...turns, { role: "user", parts: [{ text: q }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4 },
      });
      return res.status(200).json({ answer: r.text, sources: r.sources, model: r.model || MODEL });
    }
    const r = await gemini({
      systemInstruction: { parts: [{ text: HOUSE_RULES }] },
      contents: [{ role: "user", parts: [{ text: `${PROMPTS[mode] || PROMPTS.report}\nEvery number must come from DATA. Use search only for context DATA lacks (series situation, injuries, milestones), and say so.\n\nDATA:\n${JSON.stringify(context)}` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.6 },
    });
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ text: r.text, sources: r.sources, model: r.model || MODEL });
  } catch (e) {
    return res.status(e.status || 502).json({ error: String(e.message || e) });
  }
}
