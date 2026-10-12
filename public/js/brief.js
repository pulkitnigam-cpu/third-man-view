// AI brief tab: assembles the dossier into a compact context, asks /api/brief (Gemini Flash) to write it,
// and falls back to a data-only draft when the API isn't reachable.
import { deliver, tgStatus } from "./telegram.js";
import { winModel, predictXI, formLine, venueTrends, h2hRows, batFirstSplit, matchupEdge, pct, condTags, CONDITIONS } from "./stats.js";

const STEPS = [
  ["Squads and last-5 form", "Cricsheet"],
  ["Head-to-head splits", "Cricsheet"],
  ["Venue history and trends", "Cricsheet"],
  ["Match-day forecast", "Open-Meteo"],
  ["Predicted XIs", "Selection model"],
  ["Pitch report and team news", "Gemini + Google Search"],
  ["Writing the brief", "Gemini Flash"],
];

export function buildContext(S, d, h) {
  const { fx } = S, A = fx.a, B = fx.b;
  const names = { [A]: h.nm(A), [B]: h.nm(B) };
  const rows = h2hRows(d.pair, A, B, names).filter((r) => r.p);
  const VF = S.V?.fmt?.[S.fmt];
  const model = winModel({ A, B, fmt: S.fmt, home: h.homeCode(), pairMs: d.pairAll, teamA: d.teamAAll, teamB: d.teamBAll, built: d.built });
  const ctxFor = (side) => ({ opp: side === "a" ? B : A, teamLast: (side === "a" ? d.teamAAll : d.teamBAll).at(-1)?.d });
  const xi = (sq, side) => predictXI(sq, S.fmt, ctxFor(side)).map(({ p, reason, score, keeps }) => ({ name: p.n, role: p.role, score, keeps, reason }));
  const squad = (sq, xiSet) => sq.map((p) => ({ name: p.n, role: p.role, bowlingType: p.type || undefined, inXI: xiSet.has(p.id), form: formLine(p), last12m: { m: p.y1.m, runs: p.y1.r, avg: p.y1.avg, sr: p.y1.sr, wkts: p.y1.w, econ: p.y1.econ } }));
  const xiA = predictXI(d.squadA, S.fmt, ctxFor("a")), xiB = predictXI(d.squadB, S.fmt, ctxFor("b"));
  const mus = (S.P?.matchups?.[S.fmt] || []).slice(0, 40).map(([bat, bowl, balls, runs, outs]) => ({ batter: S.P.names[bat], bowler: S.P.names[bowl], balls, runs, outs, edge: matchupEdge(S.fmt, balls, runs, outs) }))
    .filter((m) => m.edge !== "even").slice(0, 10);
  const fc = S.forecast && !S.forecast.unavailable ? S.forecast : null;
  return {
    match: { teamA: names[A], teamB: names[B], codes: [A, B], format: S.fmt, series: fx.series || null, venue: S.V?.name || null, city: S.V?.city || null, startLocal: fx.start || null, hosts: h.homeCode() && h.homeCode() !== "N" ? names[h.homeCode()] : "neutral venue" },
    headToHead: {
      period: S.win === "5y" ? "last 5 years" : "all time", since: d.pair[0]?.d || null,
      splits: rows.map((r) => ({ label: r.label, played: r.p, [A]: r.a, [B]: r.b, other: r.o })),
      batFirstVsChase: batFirstSplit(d.pair),
      lastFive: d.pair.slice(-5).map((m) => ({ date: m.d, winner: m.w ? names[m.w] || m.w : m.res, margin: m.by })),
    },
    venue: VF ? { matches: VF.p, avgFirstInnings: VF.avg1, avgSecondInnings: VF.avg2, battingFirstWinPct: pct(VF.b1w, VF.res), results: VF.res, tossWinnerChoseBatPct: pct(VF.tossBat, VF.toss), trends: venueTrends(S.V, S.fmt, d.built) } : null,
    forecast: fc ? { maxTempC: Math.round(fc.tmax), humidityPct: Math.round(fc.rh), rainChancePct: fc.rainProb, cloudPct: Math.round(fc.cloud), secondHalfDewPointC: Math.round(fc.lateDew), flags: condTags({ wx: fc.wx, f: S.fmt }).map((k) => CONDITIONS.find((c) => c.k === k).label) } : null,
    winModel: model ? { [A]: Math.round(model.p * 100), [B]: 100 - Math.round(model.p * 100), factors: model.factors.map((f) => `${f.k}: ${f.sub}`) } : null,
    // every announced player, including those with no recent records in this format
    squads: Object.fromEntries([[A, d.squadA, xiA, d.extraA], [B, d.squadB, xiB, d.extraB]].map(([t, sq, xi, extra]) => [t, [...squad(sq, new Set(xi.map((x) => x.p.id))), ...(extra || []).map((x) => ({ name: x.name, role: x.role, inXI: false, form: `No recent ${S.fmt}s in the data` }))]])),
    predictedXI: { [A]: xi(d.squadA, "a"), [B]: xi(d.squadB, "b") },
    keyMatchups: mus,
    dataFreshness: `Ball-by-ball archive to ${S.meta.built}${S.fresh?.length ? `, plus scorecards of ${S.fresh.map((m) => `${m.desc} on ${m.d} (${m.status})`).join("; ")} from Cricbuzz` : ""}`,
    pitchReport: S.pitch?.report ? { ...S.pitch.report, sources: (S.pitch.notes || []).map((n) => `${n.title} (${n.kind}${n.at ? ", " + n.at : ""})`) } : null,
    // the most-faced batter-v-bowler meetings between the two current squads, this format first; capped so the prompt stays quick
    allMatchups: (() => {
      const sq = new Set([...d.squadA, ...d.squadB].map((p) => p.id)), out = [];
      for (const f of [S.fmt, ...["T20I", "ODI", "Test"].filter((x) => x !== S.fmt)]) {
        const rows = (S.P?.matchups?.[f] || []).filter(([bat, bowl]) => sq.has(bat) && sq.has(bowl)).sort((x, y) => y[2] - x[2]);
        for (const [bat, bowl, balls, runs, outs] of rows.slice(0, f === S.fmt ? 40 : 10)) out.push([S.P.names[bat], S.P.names[bowl], f, runs, balls, outs]);
      }
      return { columns: ["batter", "bowler", "format", "runs", "balls", "outs"], rows: out };
    })(),
  };
}

// Deterministic draft built only from the numbers, used when Gemini isn't reachable.
export function localBrief(c) {
  const [A, B] = c.match.codes;
  const all = c.headToHead.splits.find((s) => s.label === "All meetings");
  const lead = all ? (all[A] === all[B] ? `level at ${all[A]}–${all[B]}` : `${all[A] > all[B] ? c.match.teamA : c.match.teamB} lead ${Math.max(all[A], all[B])}–${Math.min(all[A], all[B])}`) : "no previous meetings";
  const wm = c.winModel ? `The model makes ${c.match.teamA} ${c.winModel[A]}% to ${c.winModel[B]}%.` : "";
  return {
    headline: `${c.match.teamA} v ${c.match.teamB}: ${c.match.format} preview${c.match.venue ? `, ${c.match.venue}` : ""}`,
    lede: `Head-to-head in ${c.match.format}s: ${lead} (${c.headToHead.period}). ${wm}`.trim(),
    headToHead: c.headToHead.splits.filter((s) => s.played >= 2 && s.label !== "All meetings").slice(0, 5).map((s) => `${s.label}: ${A} ${s[A]}–${s[B]} ${B} in ${s.played}`),
    venueTrends: c.venue?.trends?.length ? c.venue.trends : ["No venue history for this format in the data."],
    conditions: c.forecast ? `Forecast ${c.forecast.maxTempC} °C, ${c.forecast.humidityPct}% humidity, ${c.forecast.rainChancePct}% rain chance${c.forecast.flags.length ? `; ${c.forecast.flags.join(", ").toLowerCase()}` : ""}.` : "Forecast not available yet.",
    pitchReport: null,
    form: Object.fromEntries([A, B].map((t) => [t, [...c.squads[t].filter((p) => p.inXI), ...c.squads[t].filter((p) => !p.inXI)].map((p) => ({ player: p.name, inXI: p.inXI, note: p.form }))])),
    predictedXI: { [A]: c.predictedXI[A].map((x) => ({ player: x.name, reason: x.reason })), [B]: c.predictedXI[B].map((x) => ({ player: x.name, reason: x.reason })) },
    keyMatchups: c.keyMatchups.slice(0, 4).map((m) => `${m.batter} v ${m.bowler}: ${m.runs} off ${m.balls}, out ${m.outs}× (${m.edge === "bat" ? "batter on top" : "bowler on top"})`),
    sources: [],
  };
}

// The AI desk: one tool on screen at a time.
export function renderBriefTab(body, S, d, h) {
  S.aiMode ||= "newsletter";
  const modes = [["newsletter", "Newsletter"], ["brief", "Pre-match brief"], ["ask", "Ask Third Man"]];
  body.innerHTML = `<div class="seg sm ai-switch" role="group" aria-label="AI tool">${modes.map(([k, l]) => `<button data-ai="${k}" aria-pressed="${S.aiMode === k}">${l}</button>`).join("")}</div><div id="aiPanel"></div>`;
  body.querySelectorAll("[data-ai]").forEach((b) => (b.onclick = () => { S.aiMode = b.dataset.ai; renderBriefTab(body, S, d, h); }));
  const panel = body.querySelector("#aiPanel");
  ({ brief: briefPanel, newsletter: newsletterPanel, ask: askPanel })[S.aiMode](panel, S, d, h);
}

function briefPanel(body, S, d, h) {
  const key = `${S.fmt}|${S.win}`;
  const have = S.brief?.key === key ? S.brief : null;
  body.innerHTML = `
    <section class="sec">
      <div class="sec-h"><h3>Pre-match brief</h3><span class="aside">${h.esc(S.fmt)} · ${S.win === "5y" ? "last 5 years" : "all time"}</span></div>
      <p class="take">Structured notes for the edition: form for each predicted-XI player, head-to-head, three venue trends, the forecast and both predicted XIs. Gemini Flash also checks the latest pitch report and team news.</p>
      <button class="cta" id="genBrief" ${S.briefing ? "disabled" : ""}><span>${have ? "Regenerate brief" : "Generate brief with Gemini Flash"}</span><span aria-hidden="true">→</span></button>
      <div id="briefSteps"></div>
    </section>
    <div id="briefOut">${have ? briefHTML(have.brief, have.via, h, S) : ""}</div>`;
  body.querySelector("#genBrief").onclick = () => run(body, S, d, h, key);
  wireCopy(body, S);
}

async function run(body, S, d, h, key) {
  const token = S.token;
  S.briefing = true;
  const btn = body.querySelector("#genBrief");
  btn.disabled = true; btn.firstElementChild.textContent = "Building brief…";
  const stepsEl = body.querySelector("#briefSteps");
  stepsEl.innerHTML = `<ul class="steps">${STEPS.map(([a, b]) => `<li><span class="ic"></span><span>${a}</span><span class="src">${b}</span></li>`).join("")}</ul>`;
  const lis = [...stepsEl.querySelectorAll("li")];
  const mark = (i, cls) => lis[i] && (lis[i].className = cls);
  const ctx = buildContext(S, d, h);
  // the first five are computed in the browser: tick each only if that data is actually there
  const [A, B] = ctx.match.codes;
  const have = [
    (ctx.squads[A]?.length || 0) + (ctx.squads[B]?.length || 0) > 0,
    ctx.headToHead.splits.length > 0,
    !!ctx.venue,
    !!ctx.forecast,
    (ctx.predictedXI[A]?.length || 0) + (ctx.predictedXI[B]?.length || 0) > 0,
  ];
  have.forEach((ok, i) => mark(i, ok ? "done" : "fail"));
  mark(5, "run");
  let brief, via;
  try {
    const r = await fetch("api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: ctx }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.brief) throw new Error(j.error || `HTTP ${r.status}`);
    brief = j.brief; via = { ai: true, model: j.model, searched: j.searched };
    mark(5, j.searched || ctx.pitchReport ? "done" : "fail"); mark(6, "done");
  } catch (e) {
    brief = localBrief(ctx); via = { ai: false, why: String(e.message || e) };
    mark(5, "fail"); mark(6, "fail");
  }
  S.briefing = false;
  if (S.token !== token) return;
  S.brief = { key, brief, via, ctx };
  if (S.tab === "brief" && S.aiMode === "brief") renderBriefTab(document.getElementById("dBody"), S, d, h);
  autoSend(S, telegramReport(brief, S, ctx), S.brief, "tgBrief");
}
// Automatic delivery to Arjun, except for sample fixtures (which may not be real matches); those can still be sent by hand.
function autoSend(S, text, holder, id) {
  if (S.fx.sample) { holder.tg = { cls: "err", html: "Not sent automatically: this is a sample fixture." }; return Promise.resolve(); }
  return deliver(text, holder, id);
}

function briefHTML(b, via, h, S) {
  const [A, B] = [S.fx.a, S.fx.b];
  const e = h.esc;
  const team = (c) => `<span style="color:var(--${c === A ? "a" : "b"})">${e(h.nm(c))}</span>`;
  const list = (xs) => `<ul>${(xs || []).map((x) => `<li>${e(x)}</li>`).join("")}</ul>`;
  const xi = (c) => (b.predictedXI?.[c]?.length ? `<div><h4>${team(c)} predicted XI</h4><ol class="xi-list">${b.predictedXI[c].map((x) => `<li><div><b>${e(x.player)}</b> <span class="muted">${e(x.reason)}</span></div></li>`).join("")}</ol></div>` : "");
  const form = (c) => {
    const all = b.form?.[c] || [];
    if (!all.length) return "";
    const xi = all.filter((x) => x.inXI !== false), rest = all.filter((x) => x.inXI === false);
    const li = (x) => `<li><b>${e(x.player)}</b>: ${e(x.note)}</li>`;
    return `<div><h4>${team(c)} form · all ${all.length} squad players</h4><ul>${xi.map(li).join("")}</ul>${rest.length ? `<div class=\"grp\">Rest of the squad</div><ul>${rest.map(li).join("")}</ul>` : ""}</div>`;
  };
  return `<section class="card brief">
    <div class="brief-bar">${via.ai ? `<span class="src-pill ai">Written by ${e(via.model || "Gemini Flash")}${via.searched ? " · with web search" : ""}</span>` : `<span class="src-pill">Offline draft: built from the data without AI</span>`}
      <span style="flex:1"></span>${tgStatus(S.brief, "tgBrief")}<button class="btn" data-copy="md">Copy as Markdown</button></div>
    ${!via.ai ? `<p class="note" style="margin:0">Gemini wasn't reachable (${e(via.why)}). Deploy with <code>GEMINI_API_KEY</code> set to get the written version.</p>` : ""}
    <div><h4 style="font-size:22px;letter-spacing:.02em;text-transform:none">${e(b.headline)}</h4><p class="lede" style="margin:0">${e(b.lede)}</p></div>
    ${b.headToHead?.length ? `<div><h4>Head-to-head</h4>${list(b.headToHead)}</div>` : ""}
    <div><h4>Three venue trends</h4><ol>${(b.venueTrends || []).slice(0, 3).map((t) => `<li>${e(t)}</li>`).join("")}</ol></div>
    ${b.conditions ? `<div><h4>Conditions</h4><p style="margin:0">${e(b.conditions)}</p></div>` : ""}
    ${b.pitchReport ? `<div><h4>Pitch and team news</h4><p style="margin:0">${e(b.pitchReport)}</p></div>` : ""}
    <div class="grid2">${xi(A)}${xi(B)}</div>
    <div class="grid2">${form(A)}${form(B)}</div>
    ${b.keyMatchups?.length ? `<div><h4>Matchups to watch</h4>${list(b.keyMatchups)}</div>` : ""}
    ${b.sources?.length ? `<div class="note">Sources: ${b.sources.map((s) => `<a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title || s.url)}</a>`).join(" · ")}</div>` : ""}
  </section>`;
}

// The pre-match report sent to Telegram: match facts, pitch, head-to-head with numbers, expected XIs,
// full squads and every player's form, then the brief's analysis.
export function telegramReport(b, S, ctx) {
  const [A, B] = [S.fx.a, S.fx.b], nm = (c) => S.TEAMS[c]?.name || c, fx = S.fx, V = S.V;
  const when = fx.start ? new Date(fx.start).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) + " IST" : "";
  const L = [`# Third Man View · pre-match report`, `**${nm(A)} v ${nm(B)}** · ${S.fmt}${fx.series ? ` · ${fx.series}` : ""}`];
  if (fx.live && fx.id && !/^(custom|s\d)$/.test(fx.id)) L.push(`Match ID: ${fx.id}`);
  if (when) L.push(`When: ${when}`);
  if (V) L.push(`Venue: ${V.name}${V.city ? ", " + V.city : ""}`);
  L.push("", `**${b.headline}**`, b.lede, "");
  // pitch
  const p = S.pitch?.report, vf = ctx.venue;
  L.push("## Pitch");
  if (p?.surface || p?.favours && p.favours !== "unknown") L.push(`- Type: ${[p.surface, p.favours && p.favours !== "unknown" ? `helps ${p.favours}` : ""].filter(Boolean).join(", ")}`);
  if (p?.summary) L.push(`- ${p.summary}`);
  if (p?.expectedScore) L.push(`- Expected score: ${p.expectedScore}`);
  if (p?.dew) L.push(`- Dew and toss: ${p.dew}`);
  if (p?.teamNews) L.push(`- Team news: ${p.teamNews}`);
  if (p?.seriesPattern) L.push(`- Earlier in the series: ${p.seriesPattern}`);
  for (const q of (p?.quotes || []).slice(0, 2)) L.push(`- "${q.text}" (${q.who}${q.outlet ? ", " + q.outlet : ""})`);
  if (vf) L.push(`- At this ground: average first innings **${vf.avgFirstInnings ?? "—"}**, batting first won **${vf.battingFirstWinPct ?? "—"}%** of ${vf.results ?? vf.matches} decided ${S.fmt}s`);
  if (!p && !vf) L.push("- No pitch information yet.");
  L.push("");
  // conditions
  if (ctx.forecast) { const f = ctx.forecast; L.push("## Conditions", `- ${f.maxTempC} °C, humidity ${f.humidityPct}%, rain chance ${f.rainChancePct}%, cloud ${f.cloudPct}%, dew point ${f.secondHalfDewPointC} °C${f.flags?.length ? ` (${f.flags.join(", ").toLowerCase()})` : ""}`, ""); }
  // head-to-head with numbers
  const all = ctx.headToHead.splits.find((s) => s.label === "All meetings");
  L.push("## Head-to-head");
  if (all) L.push(`- ${S.fmt} record: **${nm(A)} ${all[A]}–${all[B]} ${nm(B)}** in ${all.played} matches${ctx.headToHead.since ? ` since ${ctx.headToHead.since.slice(0, 4)}` : ""}`);
  if (ctx.winModel) L.push(`- Win probability (model): **${nm(A)} ${ctx.winModel[A]}%**, ${nm(B)} ${ctx.winModel[B]}% (${ctx.winModel.factors.join("; ")})`);
  for (const x of b.headToHead || []) L.push(`- ${x}`);
  L.push("");
  // expected XIs and full squads
  for (const c of [A, B]) if (b.predictedXI?.[c]?.length) L.push(`## ${nm(c)} expected XI`, ...b.predictedXI[c].map((x, i) => `${i + 1}. **${x.player}**: ${x.reason}`), "");
  for (const c of [A, B]) { const sq = ctx.squads?.[c] || []; if (sq.length) L.push(`**${nm(c)} squad (${sq.length}):** ${sq.map((x) => x.name + (x.inXI ? "" : "")).join(", ")}`); }
  L.push("");
  for (const c of [A, B]) if (b.form?.[c]?.length) L.push(`## ${nm(c)} form (every squad player)`, ...b.form[c].map((x) => `- **${x.player}**${x.inXI === false ? " (squad)" : ""}: ${x.note}`), "");
  L.push("## Three venue trends", ...(b.venueTrends || []).slice(0, 3).map((x, i) => `${i + 1}. ${x}`), "");
  if (b.keyMatchups?.length) L.push("## Matchups to watch", ...b.keyMatchups.map((x) => `- ${x}`), "");
  if (ctx.dataFreshness) L.push(`_Data: ${ctx.dataFreshness}._`);
  return L.join("\n");
}

export function briefMarkdown(b, S, nm) {
  const [A, B] = [S.fx.a, S.fx.b];
  const L = [`# ${b.headline}`, "", b.lede, ""];
  if (b.headToHead?.length) L.push("## Head-to-head", ...b.headToHead.map((x) => `- ${x}`), "");
  L.push("## Three venue trends", ...(b.venueTrends || []).slice(0, 3).map((x, i) => `${i + 1}. ${x}`), "");
  if (b.conditions) L.push("## Conditions", b.conditions, "");
  if (b.pitchReport) L.push("## Pitch and team news", b.pitchReport, "");
  for (const c of [A, B]) if (b.predictedXI?.[c]?.length) L.push(`## ${nm(c)} predicted XI`, ...b.predictedXI[c].map((x, i) => `${i + 1}. **${x.player}**: ${x.reason}`), "");
  for (const c of [A, B]) if (b.form?.[c]?.length) L.push(`## ${nm(c)} form (all squad players)`, ...b.form[c].map((x) => `- **${x.player}**${x.inXI === false ? " (squad)" : ""}: ${x.note}`), "");
  if (b.keyMatchups?.length) L.push("## Matchups to watch", ...b.keyMatchups.map((x) => `- ${x}`), "");
  if (b.sources?.length) L.push("Sources: " + b.sources.map((s) => `[${s.title || s.url}](${s.url})`).join(", "));
  return L.join("\n");
}

function wireCopy(body, S) {
  const tgb = body.querySelector('[data-tg="tgBrief"]');
  if (tgb && S.brief) tgb.onclick = () => deliver(telegramReport(S.brief.brief, S, S.brief.ctx), S.brief, "tgBrief");
  const btn = body.querySelector("[data-copy]");
  if (!btn) return;
  btn.onclick = async () => {
    const md = briefMarkdown(S.brief.brief, S, (c) => S.TEAMS[c]?.name || c);
    try { await navigator.clipboard.writeText(md); btn.textContent = "Copied ✓"; } catch { btn.textContent = "Copy failed"; }
    setTimeout(() => (btn.textContent = "Copy as Markdown"), 1800);
  };
}

/* ---------- newsletter edition ---------- */
function newsletterPanel(body, S, d, h) {
  const key = `${S.fmt}|${S.win}`;
  const have = S.news?.key === key ? S.news : null;
  body.innerHTML = `<section class="sec">
    <div class="sec-h"><h3>Newsletter edition</h3><span class="aside">${h.esc(S.fmt)} · 500–700 words</span></div>
    <p class="take">A complete edition in Arjun's voice, ready to paste: the story so far, three venue trends, form guide, predicted XIs, battles to watch and the call.</p>
    <button class="cta" id="genNews" ${S.newsBusy ? "disabled" : ""}><span>${S.newsBusy ? "Writing…" : have ? "Write it again" : "Write the edition with Gemini Flash"}</span><span aria-hidden="true">→</span></button>
    ${S.newsPrep || S.newsBusy || (have && !have.error) ? newsChecklist(S, have) : ""}
    <div id="newsOut">${have ? newsHTML(have, h) : ""}</div></section>`;
  body.querySelector("#genNews").onclick = async () => {
    const token = S.token;
    S.newsBusy = true; newsletterPanel(body, S, d, h);
    try {
      const r = await fetch("api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: buildContext(S, d, h), mode: "newsletter" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.newsletter) throw new Error(j.error || `HTTP ${r.status}`);
      S.news = { key, text: j.newsletter, sources: j.sources || [], model: j.model };
      S.news.tgText = newsTelegram(S, j.newsletter);
      autoSend(S, S.news.tgText, S.news, "tgNews").then(() => { if (S.token === token && S.tab === "brief" && S.aiMode === "newsletter") newsletterPanel(body, S, d, h); });
    } catch (e) {
      S.news = { key, error: String(e.message || e) };
    }
    S.newsBusy = false;
    if (S.token === token && S.tab === "brief" && S.aiMode === "newsletter") newsletterPanel(body, S, d, h);
  };
  // one-click flow: everything is gathered, so start writing
  if (S.autoNews && !S.newsBusy && !S.newsPrep) { S.autoNews = false; body.querySelector("#genNews").click(); }
  const tgn = body.querySelector('[data-tg="tgNews"]');
  if (tgn && S.news?.tgText) tgn.onclick = () => deliver(S.news.tgText, S.news, "tgNews");
  const copy = body.querySelector("[data-copy-news]");
  if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(S.news.text); copy.textContent = "Copied ✓"; } catch { copy.textContent = "Copy failed"; } setTimeout(() => (copy.textContent = "Copy Markdown"), 1800); };
}
// What the newsletter is built from, ticked off as each piece arrives.
function newsChecklist(S, have) {
  const done = (ok, label, detail = "") => `<li class="${ok === true ? "done" : ok === false ? "fail" : "run"}"><span class="ic"></span><span>${label}</span><span class="src">${detail}</span></li>`;
  const sq = S.announced ? true : S.squadReq && !S.announced && S.squadReq.settled ? false : S.fx.live ? null : true;
  const pitchOk = S.pitch && S.pitch !== "loading" ? (S.pitch.report ? true : false) : S.fx.live ? null : false;
  const writing = S.newsBusy ? null : have?.text ? true : have?.error ? false : null;
  const tg = have?.tg?.cls === "ok" ? true : have?.tg?.cls === "err" ? false : have?.text ? null : undefined;
  return `<ul class="steps news-steps">
    ${done(S.fx.live ? (S.announced ? true : S.newsPrep ? null : false) : true, "Squads", S.announced ? { cricbuzz: "Cricbuzz, announced", cricketdata: "CricketData, announced", backup: "Google, announced" }[S.squadSource] || "announced" : S.fx.live && S.newsPrep ? "fetching…" : "from recent matches")}
    ${done(pitchOk === null && !S.newsPrep ? false : pitchOk, "Pitch notes", S.pitch?.report ? (S.pitch.report.summary ? "match report found" : "series pattern found") : S.newsPrep && S.fx.live ? "searching…" : "ground numbers only")}
    ${done(S.fx.live && S.newsPrep && !S.fresh ? null : true, "Latest form", S.fresh?.length ? `includes ${S.fresh.length} match${S.fresh.length > 1 ? "es" : ""} since ${S.meta.built}` : "archive")}
    ${S.newsPrep ? "" : done(writing, "Writing the newsletter", "Gemini Flash")}
    ${tg === undefined ? "" : done(tg, "Sent to Telegram", "@Thirdmanviewbot")}
  </ul>`;
}
function newsTelegram(S, text) {
  const fx = S.fx, nm = (c) => S.TEAMS[c]?.name || c;
  const head = [`_Third Man View · newsletter edition · ${nm(fx.a)} v ${nm(fx.b)} · ${S.fmt}${S.V ? ` · ${S.V.name}` : ""}${fx.live && fx.id && !/^(custom|s\d)$/.test(fx.id) ? ` · match ID ${fx.id}` : ""}_`, ""];
  return head.join("\n") + text;
}
function newsHTML(n, h) {
  if (n.error) return `<div class="empty">Gemini couldn't write the edition: ${h.esc(n.error)}</div>`;
  return `<article class="card brief newsletter">
    <div class="brief-bar"><span class="src-pill ai">Written by ${h.esc(n.model || "Gemini Flash")}</span><span style="flex:1"></span>${tgStatus(n, "tgNews")}<button class="btn" data-copy-news>Copy Markdown</button></div>
    ${md(n.text, h.esc)}
    ${n.sources?.length ? `<div class="note">Pitch and team news from: ${n.sources.map((s) => `<a href="${h.esc(s.url)}" target="_blank" rel="noopener">${h.esc(s.title || s.url)}</a>`).join(" · ")}</div>` : ""}
  </article>`;
}

/* ---------- Ask Third Man ---------- */
function askPanel(body, S, d, h) {
  S.chat ||= [];
  const A = S.fx.a, B = S.fx.b;
  const suggestions = [
    `Who has the edge if ${h.nm(A)} bat first?`,
    "Which batter-v-bowler battle matters most?",
    "Does the forecast change who should bowl first?",
    `Should ${h.nm(A)} pick an extra spinner here?`,
  ];
  body.innerHTML = `<section class="sec">
    <div class="sec-h"><h3>Ask Third Man</h3><span class="aside">answers from this dossier, plus web search for news</span></div>
    <div class="chat" id="chat">${S.chat.length ? S.chat.map((m) => bubble(m, h)).join("") : `<p class="take">Ask anything about this match. Try one of these:</p><div class="chips">${suggestions.map((q) => `<button class="chip-btn" data-q="${h.esc(q)}">${h.esc(q)}</button>`).join("")}</div>`}</div>
    <form class="ask" id="askForm"><input id="askIn" type="text" placeholder="e.g. How has Bumrah done against Head?" autocomplete="off" aria-label="Your question" ${S.asking ? "disabled" : ""}><button class="cta-sm" ${S.asking ? "disabled" : ""}>${S.asking ? "Thinking…" : "Ask"}</button></form>
    ${S.chat.length ? `<button class="btn" id="askClear" style="justify-self:start">Clear conversation</button>` : ""}
  </section>`;
  const send = async (q) => {
    q = q.trim(); if (!q || S.asking) return;
    const token = S.token;
    const history = S.chat.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    S.chat.push({ role: "user", text: q }); S.asking = true; askPanel(body, S, d, h);
    try {
      const r = await fetch("api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: buildContext(S, d, h), question: q, history }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.answer) throw new Error(j.error || `HTTP ${r.status}`);
      S.chat.push({ role: "model", text: j.answer, sources: j.sources || [] });
    } catch (e) {
      S.chat.push({ role: "model", text: `Couldn't get an answer: ${e.message || e}`, error: true });
    }
    S.asking = false;
    if (S.token === token && S.tab === "brief" && S.aiMode === "ask") { askPanel(body, S, d, h); body.querySelector("#askIn")?.focus(); }
  };
  body.querySelector("#askForm").onsubmit = (e) => { e.preventDefault(); send(body.querySelector("#askIn").value); };
  body.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => send(b.dataset.q)));
  const clr = body.querySelector("#askClear"); if (clr) clr.onclick = () => { S.chat = []; askPanel(body, S, d, h); };
  const chat = body.querySelector("#chat"); chat.scrollTop = chat.scrollHeight;
}
const bubble = (m, h) => `<div class="msg ${m.role}${m.error ? " err" : ""}">${m.role === "user" ? h.esc(m.text) : md(m.text, h.esc)}${m.sources?.length ? `<div class="note">Sources: ${m.sources.map((s) => `<a href="${h.esc(s.url)}" target="_blank" rel="noopener">${h.esc(s.title || s.url)}</a>`).join(" · ")}</div>` : ""}</div>`;

// Minimal, safe Markdown: escape first, then headings, lists, bold/italic, paragraphs.
export function md(src, esc) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>");
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(src || "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); const lv = m[1].length; out.push(lv === 1 ? `<h4 class="nl-h1">${inline(m[2])}</h4>` : `<h4>${inline(m[2])}</h4>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join("");
}
