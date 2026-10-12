// Shared Gemini Flash helpers for the api/ functions (files starting with "_" are not deployed as endpoints).
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const URL = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// Free-tier limits are per model, so when one Flash model is rate-limited or out of quota, try the next.
const FALLBACKS = (process.env.GEMINI_FALLBACKS || "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest").split(",").map((m) => m.trim()).filter(Boolean);
export let lastModel = MODEL;

// Speed: Gemini 3 Flash "thinks" before answering by default; "low" halves response time (7 s -> 3.5 s in tests)
// with no visible loss for writing and summarising. A call can still ask for more with its own thinkingConfig.
// Google Search grounding has its own daily allowance shared by every model, so a refused search is not retried
// on other models, and searching pauses for 20 minutes.
let searchPausedUntil = 0;
export const searchAvailable = () => Date.now() > searchPausedUntil;

// Backup route: the same Gemini Flash models through OpenRouter, pinned to Google's own servers. Used only when the
// direct key is missing, out of quota or failing, including searches once the direct search allowance is used up.
const OR_MODEL = process.env.OPENROUTER_MODEL || `google/${MODEL}`;
const lower = (x) => (Array.isArray(x) ? x.map(lower) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : lower(v)])) : x);
async function openrouter(body) {
  const key = process.env.OPENROUTER_API_KEY;
  const g = body.generationConfig || {};
  const text = (c) => (c?.parts || []).map((p) => p.text || "").join("");
  const messages = [
    ...(body.systemInstruction ? [{ role: "system", content: text(body.systemInstruction) }] : []),
    ...(body.contents || []).map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: text(c) })),
  ];
  const payload = {
    model: OR_MODEL, messages,
    provider: { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false },
    reasoning: { effort: "low" },
    ...(g.temperature != null ? { temperature: g.temperature } : {}),
    ...(g.maxOutputTokens ? { max_tokens: g.maxOutputTokens } : {}),
    ...(g.responseSchema ? { response_format: { type: "json_schema", json_schema: { name: "out", strict: false, schema: lower(g.responseSchema) } } } : g.responseMimeType === "application/json" ? { response_format: { type: "json_object" } } : {}),
    ...((body.tools || []).some((t) => t.google_search) ? { plugins: [{ id: "web", engine: "native" }] } : {}),
  };
  let r, j;
  for (let i = 0; i < 3; i++) {
    r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-title": "Third Man View" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    j = await r.json().catch(() => ({}));
    if (r.status !== 429 && r.status < 500) break;
    await new Promise((w) => setTimeout(w, 800 * 2 ** i));
  }
  if (!r.ok || j.error) throw Object.assign(new Error(`OpenRouter: ${j.error?.message || r.status}`), { status: r.status === 402 ? 402 : 502 });
  const m = j.choices?.[0]?.message || {};
  lastModel = `${j.model || OR_MODEL} via OpenRouter`;
  return {
    model: lastModel,
    text: (typeof m.content === "string" ? m.content : "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim(),
    sources: (m.annotations || []).filter((a) => a.type === "url_citation").map((a) => a.url_citation).slice(0, 6).map((w) => ({ url: w.url, title: w.title || w.url })),
  };
}

export async function gemini(body) {
  if (!process.env.OPENROUTER_API_KEY) return direct(body);
  try { return await direct(body); } catch (e) {
    if (e.status === 400) throw e; // a bad request fails the same way on both routes
    return openrouter(body);
  }
}

async function direct(body) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error("GEMINI_API_KEY is not set"), { status: 503 });
  const searching = (body.tools || []).some((t) => t.google_search);
  if (searching && !searchAvailable()) throw Object.assign(new Error("Google Search allowance used up for now"), { status: 429, search: true });
  const withLow = { ...body, generationConfig: { ...(body.generationConfig || {}), thinkingConfig: body.generationConfig?.thinkingConfig || { thinkingLevel: "low" } } };
  let lastErr;
  for (const model of [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)]) {
    let payload = withLow;
    const call = () => fetch(URL(model), { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload), signal: AbortSignal.timeout(90000) });
    let r;
    try { r = await call(); } catch { await new Promise((s) => setTimeout(s, 600)); try { r = await call(); } catch (e) { lastErr = e; continue; } }
    let j = await r.json().catch(() => ({}));
    // older models without thinking levels: retry once without the setting
    if (r.status === 400 && /thinking/i.test(j.error?.message || "")) { payload = body; r = await call(); j = await r.json().catch(() => ({})); }
    if (r.status >= 500) { await new Promise((s) => setTimeout(s, 1000)); r = await call(); j = await r.json().catch(() => ({})); }
    if (r.status === 429 && searching) { searchPausedUntil = Date.now() + 20 * 60 * 1000; throw Object.assign(new Error("Google Search allowance used up for now"), { status: 429, search: true }); }
    if (r.status === 429 || r.status === 404) { lastErr = new Error(j.error?.message || `Gemini ${r.status}`); continue; } // quota / unavailable: next model
    if (!r.ok) throw Object.assign(new Error(j.error?.message || `Gemini ${r.status}`), { status: r.status === 400 ? 400 : 502 });
    lastModel = model;
    const c = j.candidates?.[0];
    return {
      model,
      text: (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim(),
      sources: (c?.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter(Boolean).slice(0, 6).map((w) => ({ url: w.uri, title: w.title })),
    };
  }
  throw Object.assign(new Error(`All Gemini Flash models are rate-limited right now (${lastErr?.message?.slice(0, 120) || "unknown"})`), { status: 429 });
}

// Same rules everywhere: the computed data wins, search fills in current news, nothing is invented.
export const HOUSE_RULES = `You are the research brain behind "Third Man View", Arjun's cricket tips newsletter (2,400 readers, India-focused).
- Treat DATA (computed from Cricsheet ball-by-ball records and Open-Meteo weather) as ground truth. Never invent statistics, players or results.
- Use web search only for things DATA cannot know: pitch reports, injuries, squad announcements, today's news. Say when something comes from news.
- Keep player names as they appear in DATA.
- Plain, confident British English. No hype words, no emojis.`;

export function readBody(req) {
  const b = req.body;
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } }
  return b || {};
}
