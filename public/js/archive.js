// Past matches: filter any team's internationals, open a match review (scorecard, story, AI match report),
// or have Gemini review the whole filtered period.
import { getTeam, getJSON } from "./data.js";
import { md } from "./brief.js";
import { CONDITIONS, condTags, pct } from "./stats.js";
import { deliver, tgStatus } from "./telegram.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const FMTS = ["T20I", "ODI", "Test"];
const sec = (title, { aside = "", take = "", body = "" } = {}) => `<section class="sec"><div class="sec-h"><h3>${title}</h3>${aside ? `<span class="aside">${aside}</span>` : ""}</div>${take ? `<p class="take">${take}</p>` : ""}${body}</section>`;

let D, A; // deps, state

export function initArchive(deps) {
  D = deps;
  A = { team: "IND", opp: "", fmt: "T20I", year: "", res: "", shown: 40, view: "list", match: null, tab: "card", period: null, chat: [], busy: false };
  const el = $("#archive");
  el.addEventListener("click", onClick);
  el.addEventListener("change", (e) => {
    const f = e.target.dataset.f; if (!f) return;
    A[f] = e.target.value; if (f === "team") A.opp = ""; A.shown = 40; A.period = null; A.chat = [];
    render();
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-m]")) e.target.click(); });
  el.addEventListener("submit", (e) => { e.preventDefault(); const i = $("#arAsk"); if (i?.value.trim()) ask(i.value.trim()); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && el.classList.contains("open") && !$("#finder").open) { if (A.view === "match") { A.view = "list"; render(); } else D.onClose(); } });
}

export function openArchive() {
  const el = $("#archive");
  el.classList.add("open"); el.inert = false; el.setAttribute("aria-hidden", "false");
  document.body.classList.add("archive-open");
  render();
}
export function closeArchive() {
  const el = $("#archive");
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.classList.remove("open"); el.inert = true; el.setAttribute("aria-hidden", "true");
  document.body.classList.remove("archive-open");
}

const T = () => D.teams();
const nm = (c) => T()[c]?.name || c;
const venueName = (id) => { const v = D.venues()[id]; return v ? `${v.name}${v.city ? ", " + v.city : ""}` : ""; };

/* ---------- data ---------- */
async function teamMatches() {
  const t = await getTeam(A.team);
  return t?.formats || {};
}
function filtered(formats) {
  let ms = (formats[A.fmt]?.matches || []).slice();
  if (A.opp) ms = ms.filter((m) => m.t.includes(A.opp));
  if (A.year) ms = ms.filter((m) => m.d.startsWith(A.year));
  const outcome = (m) => (m.res === "W" ? (m.w === A.team ? "won" : "lost") : "other");
  if (A.res) ms = ms.filter((m) => outcome(m) === A.res);
  return ms.reverse();
}

/* ---------- render ---------- */
async function render() {
  const el = $("#archive .ar-scroll");
  if (A.view === "match") return renderMatch(el);
  const formats = await teamMatches();
  const all = (formats[A.fmt]?.matches || []);
  const ms = filtered(formats);
  const opps = [...new Set(all.map((m) => m.t.find((x) => x !== A.team)))].sort((a, b) => nm(a).localeCompare(nm(b)));
  const years = [...new Set(all.map((m) => m.d.slice(0, 4)))].sort().reverse();
  const teams = Object.entries(T()).filter(([, v]) => (v.n?.T20I || 0) + (v.n?.ODI || 0) + (v.n?.Test || 0) > 0)
    .sort(([, a], [, b]) => (b.major - a.major) || a.name.localeCompare(b.name));
  const opt = (v, l, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`;
  const w = ms.filter((m) => m.res === "W" && m.w === A.team).length, l = ms.filter((m) => m.res === "W" && m.w !== A.team).length, o = ms.length - w - l;
  const bf = ms.filter((m) => m.res === "W" && m.b1 === A.team), ch = ms.filter((m) => m.res === "W" && m.b1 && m.b1 !== A.team);
  const scope = `${nm(A.team)} · ${A.fmt}s${A.opp ? ` v ${nm(A.opp)}` : ""}${A.year ? ` · ${A.year}` : ""}${A.res ? ` · ${A.res}` : ""}`;
  el.innerHTML = `
  <div class="ar-filters">
    <label>Team<select data-f="team">${teams.map(([c, v]) => opt(c, v.name, A.team)).join("")}</select></label>
    <label>Opponent<select data-f="opp">${opt("", "Any opponent", A.opp)}${opps.map((c) => opt(c, nm(c), A.opp)).join("")}</select></label>
    <label>Year<select data-f="year">${opt("", "All years", A.year)}${years.map((y) => opt(y, y, A.year)).join("")}</select></label>
    <div class="ar-segs">
      <div class="seg sm" role="group" aria-label="Format">${FMTS.map((f) => `<button data-fmt="${f}" aria-pressed="${A.fmt === f}"${formats[f] ? "" : " disabled style=\"opacity:.35\""}>${f}</button>`).join("")}</div>
      <div class="seg sm" role="group" aria-label="Result">${[["", "All"], ["won", "Won"], ["lost", "Lost"], ["other", A.fmt === "Test" ? "Drawn/NR" : "Tied/NR"]].map(([k, lab]) => `<button data-res="${k}" aria-pressed="${A.res === k}">${lab}</button>`).join("")}</div>
    </div>
  </div>
  ${!ms.length ? `<div class="empty">No matches for ${esc(scope)}.</div>` : `
  ${sec("Record", { aside: esc(scope), take: `${esc(nm(A.team))} won <b>${w} of ${w + l}</b> decisive matches${w + l ? ` (${pct(w, w + l)}%)` : ""}${o ? `, with ${o} ${A.fmt === "Test" ? "drawn or tied" : "tied or no result"}` : ""}. Batting first: <b>${bf.filter((m) => m.w === A.team).length}–${bf.filter((m) => m.w !== A.team).length}</b>; chasing: <b>${ch.filter((m) => m.w === A.team).length}–${ch.filter((m) => m.w !== A.team).length}</b>.`,
    body: `<div class="kpis"><div class="kpi"><div class="k">Played</div><div class="v">${ms.length}</div></div><div class="kpi"><div class="k">Won</div><div class="v">${w}</div></div><div class="kpi"><div class="k">Lost</div><div class="v">${l}</div></div><div class="kpi"><div class="k">Win rate</div><div class="v">${w + l ? pct(w, w + l) + "%" : "—"}</div></div></div>` })}
  ${sec("✦ AI on these matches", { aside: "Gemini Flash", body: periodAI(ms) })}
  ${sec("Matches", { aside: `${ms.length} · newest first · tap one to review it`, body: `<div class="tbl-wrap"><table class="tbl ar-list"><thead><tr><th>Date</th><th>Opponent</th><th>Venue</th><th>Result</th><th>Scores</th></tr></thead><tbody>
    ${ms.slice(0, A.shown).map((m) => { const opp = m.t.find((x) => x !== A.team), won = m.res === "W" && m.w === A.team, lost = m.res === "W" && !won;
      return `<tr data-m="${m.id}" tabindex="0"><td class="num nowrap">${dmy(m.d)}</td><td class="nowrap">${esc(nm(opp))}</td><td>${esc(venueName(m.v))}</td><td class="nowrap"><span class="rchip ${won ? "W" : lost ? "L" : "O"}">${won ? "Won" : lost ? "Lost" : { D: "Draw", T: "Tie", NR: "NR" }[m.res] || "—"}</span> <span class="muted">${esc(m.by || "")}</span></td><td>${m.s.map(([t, r, wk, ov]) => `${esc(t)} ${r}${wk < 10 ? "/" + wk : ""}${A.fmt === "Test" ? "" : ` <span class="muted">(${ov})</span>`}`).join(" · ")}</td></tr>`; }).join("")}
  </tbody></table></div>${ms.length > A.shown ? `<button class="btn" data-more>Show ${Math.min(40, ms.length - A.shown)} more</button>` : ""}` })}`}`;
  A._list = ms;
}

function periodAI(ms) {
  const p = A.period;
  return `<p class="take" style="margin-bottom:8px">Have Gemini write a newsletter review of these ${ms.length} matches, or ask it anything about them.</p>
    <div class="ar-ai-row"><button class="cta-sm" data-period ${A.busy ? "disabled" : ""}>${A.busy === "period" ? "Writing…" : p ? "Write the review again" : "Write a review of this period"}</button></div>
    ${p ? (p.error ? `<div class="empty">${esc(p.error)}</div>` : `<article class="card brief newsletter"><div class="brief-bar"><span class="src-pill ai">Written by ${esc(p.model)}</span><span style="flex:1"></span>${tgStatus(p, "tgPeriod")}<button class="btn" data-copy="period">Copy Markdown</button></div>${md(p.text, esc)}</article>`) : ""}
    ${chatHTML("Ask about these matches, e.g. Who scored most runs in these games?")}`;
}
function chatHTML(placeholder) {
  return `<div class="chat">${A.chat.map((m) => `<div class="msg ${m.role}${m.error ? " err" : ""}">${m.role === "user" ? esc(m.text) : md(m.text, esc)}${m.sources?.length ? `<div class="note">Sources: ${m.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join(" · ")}</div>` : ""}</div>`).join("")}</div>
    <form class="ask"><input id="arAsk" type="text" placeholder="${esc(placeholder)}" autocomplete="off" ${A.busy ? "disabled" : ""}><button class="cta-sm" ${A.busy ? "disabled" : ""}>${A.busy === "ask" ? "Thinking…" : "Ask"}</button></form>`;
}

/* ---------- one match ---------- */
async function renderMatch(el) {
  const m = A.match;
  el.innerHTML = `<div class="sk" style="height:140px"></div><div class="sk" style="height:300px;margin-top:14px"></div>`;
  const sc = await getJSON(`data/scorecards/${m.d.slice(0, 7)}.json`).catch(() => null);
  const card = sc?.matches?.[m.id];
  A.card = card; A.names = sc?.names || {};
  const [a, b] = m.t, V = D.venues()[m.v];
  const pom = card?.pom?.map((id) => A.names[id] || id).join(", ");
  const resultLine = m.res === "W" ? `${esc(nm(m.w))} won by ${esc(m.by)}${m.dl ? " (DLS)" : ""}` : { D: "Match drawn", T: "Match tied", NR: "No result" }[m.res] || "";
  const tabs = [["card", "Scorecard"], ["story", "Story"], ["report", "✦ Match report"]];
  el.innerHTML = `
  <button class="btn" data-back>← All matches</button>
  <div class="mr-head">
    <div class="series">${esc(card?.ev || "")}${card?.mno ? ` · match ${card.mno}` : ""}</div>
    <h2><span style="color:${D.teams()[a]?.c || "var(--fg)"}">${esc(nm(a))}</span> <span class="muted">v</span> <span style="color:${D.teams()[b]?.c || "var(--fg)"}">${esc(nm(b))}</span></h2>
    <div class="mr-result">${resultLine}</div>
    <div class="facts"><span><b>Date</b>${dmy(m.d)}</span>${V ? `<span><b>Venue</b>${esc(V.name)}, ${esc(V.city || "")}</span>` : ""}${m.toss ? `<span><b>Toss</b>${esc(nm(m.toss[0]))}, chose to ${esc(m.toss[1])}</span>` : ""}${pom ? `<span><b>Player of the match</b>${esc(pom)}</span>` : ""}</div>
  </div>
  <nav class="tabs ar-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-mtab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join("")}</nav>
  <div class="ar-mbody">${!card ? `<div class="empty">Scorecard not available for this match.</div>` : A.tab === "card" ? scorecard(card, m) : A.tab === "story" ? story(card, m) : reportTab()}</div>`;
}

function disText(d) {
  if (!d) return "not out";
  const [kind, f, b] = d, sur = (id) => { if (!id) return ""; if (String(id).startsWith("sub:")) return `sub (${id.slice(4).split(" ").pop()})`; return (A.names[id] || id).split(" ").pop(); };
  if (kind === "caught") return f && f === b ? `c & b ${sur(b)}` : `c ${sur(f)} b ${sur(b)}`;
  if (kind === "caught and bowled") return `c & b ${sur(b)}`;
  if (kind === "bowled") return `b ${sur(b)}`;
  if (kind === "lbw") return `lbw b ${sur(b)}`;
  if (kind === "stumped") return `st ${sur(f)} b ${sur(b)}`;
  if (kind === "run out") return `run out${f ? ` (${sur(f)})` : ""}`;
  if (kind === "hit wicket") return `hit wicket b ${sur(b)}`;
  return kind;
}
function scorecard(card, m) {
  return card.inns.map((i, n) => sec(`${esc(nm(i.t))} ${m.f === "Test" ? (n < 2 ? "1st" : "2nd") + " innings" : "innings"}`, {
    aside: `${i.r}${i.w < 10 ? "/" + i.w : ""}${i.dec ? " dec" : ""} (${i.ov} ov)`,
    body: `<div class="tbl-wrap"><table class="tbl sc"><thead><tr><th>Batter</th><th></th><th class="r">R</th><th class="r">B</th><th class="r">4s</th><th class="r">6s</th><th class="r">SR</th></tr></thead><tbody>
      ${i.bat.map(([id, r, b, f, s, d]) => `<tr><td class="nowrap"><b>${esc(A.names[id] || id)}</b></td><td class="muted">${esc(disText(d))}</td><td class="r num"><b>${r}</b></td><td class="r num">${b}</td><td class="r num">${f}</td><td class="r num">${s}</td><td class="r num">${b ? Math.round((100 * r) / b) : "—"}</td></tr>`).join("")}
      <tr class="sub"><td>Extras</td><td></td><td class="r num">${i.ex}</td><td colspan="4"></td></tr>
      <tr class="sub"><td><b>Total</b></td><td class="muted">${i.ov} overs</td><td class="r num"><b>${i.r}${i.w < 10 ? "/" + i.w : ""}</b></td><td colspan="4"></td></tr>
    </tbody></table></div>
    <div class="tbl-wrap"><table class="tbl sc"><thead><tr><th>Bowler</th><th class="r">O</th><th class="r">M</th><th class="r">R</th><th class="r">W</th><th class="r">Econ</th></tr></thead><tbody>
      ${i.bowl.map(([id, ov, md, r, w]) => { const [o, b = "0"] = String(ov).split("."), balls = +o * 6 + +b; return `<tr><td class="nowrap">${esc(A.names[id] || id)}</td><td class="r num">${ov}</td><td class="r num">${md}</td><td class="r num">${r}</td><td class="r num"><b>${w}</b></td><td class="r num">${balls ? ((6 * r) / balls).toFixed(1) : "—"}</td></tr>`; }).join("")}
    </tbody></table></div>`,
  })).join("");
}

function story(card, m) {
  const bats = card.inns.flatMap((i) => i.bat.map(([id, r, b, f, s, d]) => ({ id, t: i.t, r, b, out: !!d }))).sort((x, y) => y.r - x.r).slice(0, 4);
  const bowls = card.inns.flatMap((i) => i.bowl.map(([id, ov, md, r, w]) => ({ id, t: i.t === m.t[0] ? m.t[1] : m.t[0], ov, r, w }))).sort((x, y) => y.w - x.w || x.r - y.r).slice(0, 4);
  const L = m.f === "T20I" ? ["Powerplay (1–6)", "Middle (7–15)", "Death (16–20)"] : ["Powerplay (1–10)", "Middle (11–40)", "Death (41–50)"];
  const phases = m.f !== "Test" && card.inns.some((i) => i.ph?.some((p) => p[1])) ? sec("Phase by phase", { aside: "runs / wickets (run rate)", body: `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${L.map((l) => `<th class="r">${l}</th>`).join("")}</tr></thead><tbody>
    ${card.inns.slice(0, 2).map((i) => `<tr><td><b>${esc(nm(i.t))}</b></td>${i.ph.map(([r, b, w]) => `<td class="r num">${b ? `${r}/${w} <span class="muted">(${((6 * r) / b).toFixed(1)})</span>` : "—"}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>` }) : "";
  const wx = m.wx;
  const tags = wx ? condTags(m).map((k) => CONDITIONS.find((c) => c.k === k).label.toLowerCase()) : [];
  // rivalry before this match, from the team's own match list
  const opp = m.t.find((x) => x !== A.team), before = (D._teamCache?.formats?.[m.f]?.matches || []).filter((x) => x.d < m.d && x.t.includes(opp));
  const bw = before.filter((x) => x.res === "W" && x.w === A.team).length, bl = before.filter((x) => x.res === "W" && x.w === opp).length;
  return `
  ${sec("Standouts", { body: `<div class="grid2">
    <div class="card"><table class="tbl"><thead><tr><th>Top scores</th><th class="r">R</th><th class="r">B</th></tr></thead><tbody>${bats.map((x) => `<tr><td>${esc(A.names[x.id] || x.id)} <span class="muted">${esc(x.t)}</span></td><td class="r num"><b>${x.r}${x.out ? "" : "*"}</b></td><td class="r num">${x.b}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><table class="tbl"><thead><tr><th>Best bowling</th><th class="r">Figures</th><th class="r">O</th></tr></thead><tbody>${bowls.map((x) => `<tr><td>${esc(A.names[x.id] || x.id)} <span class="muted">${esc(x.t)}</span></td><td class="r num"><b>${x.w}/${x.r}</b></td><td class="r num">${x.ov}</td></tr>`).join("")}</tbody></table></div>
  </div>` })}
  ${phases}
  ${sec("Context", { body: `<dl class="flist">
    <div><dt>Result</dt><dd>${m.res === "W" ? `${esc(nm(m.w))} won by ${esc(m.by)}${/innings/i.test(m.by || "") ? "" : m.b1 === m.w ? "; batting first" : "; chasing"}.` : esc({ D: "Drawn", T: "Tied", NR: "No result" }[m.res] || "")}</dd></div>
    ${m.toss ? `<div><dt>Toss</dt><dd>${esc(nm(m.toss[0]))} chose to ${esc(m.toss[1])}${m.res === "W" ? ` and ${m.w === m.toss[0] ? "won" : "lost"}` : ""}.</dd></div>` : ""}
    ${wx ? `<div><dt>Conditions</dt><dd>${wx[0]} °C, ${wx[2]}% humidity, ${wx[3]}% cloud${wx[1] ? `, ${wx[1]} mm rain over the match` : ""}${tags.length ? ` (${tags.join(", ")})` : ""}.</dd></div>` : ""}
    <div><dt>Rivalry before</dt><dd>${before.length ? `${esc(nm(A.team))} ${bw}–${bl} ${esc(nm(opp))} in ${before.length} earlier ${m.f}s.` : `Their first ${m.f} meeting in the data.`}</dd></div>
  </dl>` })}`;
}

function reportTab() {
  const r = A.report;
  return `${sec("Match report", { aside: "Gemini Flash", take: "A newsletter-ready report on this match, written from the scorecard, phases and conditions.", body: `
    <button class="cta" data-report ${A.busy ? "disabled" : ""}><span>${A.busy === "report" ? "Writing…" : r ? "Write it again" : "Write the match report"}</span><span aria-hidden="true">→</span></button>
    ${r ? (r.error ? `<div class="empty">${esc(r.error)}</div>` : `<article class="card brief newsletter"><div class="brief-bar"><span class="src-pill ai">Written by ${esc(r.model)}</span><span style="flex:1"></span>${tgStatus(r, "tgReport")}<button class="btn" data-copy="report">Copy Markdown</button></div>${md(r.text, esc)}${r.sources?.length ? `<div class="note">Context from: ${r.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>`).join(" · ")}</div>` : ""}</article>`) : ""}` })}
  ${sec("Ask about this match", { body: chatHTML("e.g. Where was the game won?") })}`;
}

/* ---------- AI contexts ---------- */
function matchContext() {
  const m = A.match, c = A.card;
  return {
    match: { teams: m.t.map(nm), format: m.f, date: m.d, venue: venueName(m.v), event: c?.ev, matchNo: c?.mno, toss: m.toss && { winner: nm(m.toss[0]), chose: m.toss[1] }, result: m.res === "W" ? `${nm(m.w)} won by ${m.by}` : m.res, playerOfMatch: c?.pom?.map((id) => A.names[id]) },
    conditions: m.wx && { maxTempC: m.wx[0], rainMmWholeMatch: m.wx[1], humidityPct: m.wx[2], cloudPct: m.wx[3], dewPointC: m.wx[4] },
    innings: (c?.inns || []).map((i) => ({ team: nm(i.t), total: `${i.r}/${i.w}`, overs: i.ov, extras: i.ex, declared: !!i.dec,
      phases: i.ph?.map(([r, b, w], k) => ({ phase: ["powerplay", "middle", "death"][k], runs: r, balls: b, wkts: w })),
      batting: i.bat.map(([id, r, b, f, s, d]) => ({ name: A.names[id], how: disText(d), runs: r, balls: b, fours: f, sixes: s })),
      bowling: i.bowl.map(([id, ov, md, r, w]) => ({ name: A.names[id], overs: ov, maidens: md, runs: r, wkts: w })) })),
  };
}
function periodContext() {
  const ms = A._list || [];
  return {
    scope: { team: nm(A.team), format: A.fmt, opponent: A.opp ? nm(A.opp) : "all", year: A.year || "all", result: A.res || "all" },
    matches: ms.slice(0, 80).map((m) => ({ date: m.d, opponent: nm(m.t.find((x) => x !== A.team)), venue: venueName(m.v), home: m.h === A.team ? "home" : m.h === "N" ? "neutral" : "away", result: m.res === "W" ? `${nm(m.w)} won by ${m.by}` : m.res, battedFirst: m.b1 ? nm(m.b1) : null, scores: m.s.map(([t, r, w, ov]) => `${t} ${r}/${w} (${ov})`).join(", ") })),
  };
}

/* ---------- actions ---------- */
async function callReview(body) {
  const r = await fetch("api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function ask(q) {
  const context = A.view === "match" ? matchContext() : periodContext();
  const history = A.chat.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
  A.chat.push({ role: "user", text: q }); A.busy = "ask"; render();
  try { const j = await callReview({ mode: "ask", context, question: q, history }); A.chat.push({ role: "model", text: j.answer, sources: j.sources }); }
  catch (e) { A.chat.push({ role: "model", text: `Couldn't get an answer: ${e.message}`, error: true }); }
  A.busy = false; render();
}
async function onClick(e) {
  const t = e.target.closest("[data-m],[data-fmt],[data-res],[data-more],[data-back],[data-mtab],[data-report],[data-period],[data-copy],[data-close],[data-tg]");
  if (!t) return;
  if (t.dataset.tg === "tgReport" && A.report?.tgText) return deliver(A.report.tgText, A.report, "tgReport");
  if (t.dataset.tg === "tgPeriod" && A.period?.tgText) return deliver(A.period.tgText, A.period, "tgPeriod");
  if (t.dataset.close != null) return D.onClose();
  if (t.dataset.m) {
    A.match = A._list.find((m) => m.id === t.dataset.m); A.view = "match"; A.tab = "card"; A.report = null; A.chat = [];
    D._teamCache = await getTeam(A.team);
    $("#archive .ar-scroll").scrollTop = 0;
    return render();
  }
  if (t.dataset.fmt) { A.fmt = t.dataset.fmt; A.shown = 40; A.period = null; A.chat = []; }
  if (t.dataset.res != null && t.dataset.res !== undefined && t.hasAttribute("data-res")) { A.res = t.dataset.res; A.shown = 40; A.period = null; A.chat = []; }
  if (t.dataset.more != null) A.shown += 40;
  if (t.dataset.back != null) { A.view = "list"; A.chat = []; }
  if (t.dataset.mtab) A.tab = t.dataset.mtab;
  if (t.dataset.copy) { const txt = t.dataset.copy === "report" ? A.report?.text : A.period?.text; try { await navigator.clipboard.writeText(txt || ""); t.textContent = "Copied ✓"; } catch { t.textContent = "Copy failed"; } return; }
  if (t.dataset.report != null) {
    A.busy = "report"; render();
    try {
      const j = await callReview({ mode: "report", context: matchContext() });
      const m = A.match;
      A.report = { text: j.text, sources: j.sources, model: j.model, tgText: `_Third Man View · match report · ${m.t.map(nm).join(" v ")} · ${m.f} · ${dmy(m.d)}${venueName(m.v) ? " · " + venueName(m.v) : ""}_\n\n` + j.text };
      deliver(A.report.tgText, A.report, "tgReport");
    }
    catch (err) { A.report = { error: `Gemini couldn't write the report: ${err.message}` }; }
    A.busy = false;
  }
  if (t.dataset.period != null) {
    A.busy = "period"; render();
    try {
      const j = await callReview({ mode: "period", context: periodContext() });
      A.period = { text: j.text, model: j.model, tgText: `_Third Man View · review · ${nm(A.team)} ${A.fmt}s${A.opp ? " v " + nm(A.opp) : ""}${A.year ? " · " + A.year : ""}_\n\n` + j.text };
      deliver(A.period.tgText, A.period, "tgPeriod");
    }
    catch (err) { A.period = { error: `Gemini couldn't write the review: ${err.message}` }; }
    A.busy = false;
  }
  render();
}
