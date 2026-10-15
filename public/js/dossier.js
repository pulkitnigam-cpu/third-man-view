// The match dossier: everything Arjun needs for one fixture, in tabs.
import { getTeam, getPair, getForecast } from "./data.js";
import {
  FORMATS, CONDITIONS, SURFACES, condTags, windowed, h2hRows, teamRows, batFirstSplit, tossSplit, teamRecord, formString,
  winModel, predictXI, selectionScore, RUBRIC, applyAnnounced, mergeRecent, compactRecent, formLine, matchupEdge, venueTrends, pct, oversToBalls,
} from "./stats.js";
import { renderBriefTab } from "./brief.js";
import { renderPlayersTab } from "./players.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pc = (a, b) => { const v = pct(a, b); return v == null ? "—" : `${v}%`; };
const dmy = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (iso, tz) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }).format(new Date(iso));
const TABS = [["overview", "Overview"], ["h2h", "Head-to-head"], ["venue", "Venue & conditions"], ["squads", "Squads & form"], ["matchups", "Players & matchups"], ["brief", "✦ Write"]];

let S = null; // current dossier state

export function closeDossier() {
  const el = $("#dossier");
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.classList.remove("open"); el.setAttribute("aria-hidden", "true"); el.inert = true;
  document.body.classList.remove("open");
  S = null;
}

/** ctx: { fx:{id,a,b,fmt,series,venue,start,tz,status,statusLabel}, V: venue|null, meta, TEAMS, onClose } */
export async function openDossier(ctx) {
  const el = $("#dossier");
  const token = Symbol();
  S = { ...ctx, token, fmt: ctx.fx.fmt, win: "all", tab: ctx.autoNews ? "brief" : "overview", aiMode: ctx.autoNews ? "newsletter" : undefined, newsPrep: !!ctx.autoNews, forecast: undefined, pp: null, PL: null, muSide: "a", sqShow: "a", openPl: new Set(), showAllRes: false, brief: null };
  const { fx, TEAMS } = ctx;
  el.style.setProperty("--a", TEAMS[fx.a]?.c || "#8fd3ff");
  el.style.setProperty("--b", TEAMS[fx.b]?.c && TEAMS[fx.b].c !== TEAMS[fx.a]?.c ? TEAMS[fx.b].c : "#cfd6de");
  el.innerHTML = shell();
  el.classList.add("open"); el.setAttribute("aria-hidden", "false"); el.inert = false;
  document.body.classList.add("open");
  el.focus({ preventScroll: true });
  bind(el);
  renderBody(); // skeleton
  const [A, B, P] = await Promise.all([getTeam(fx.a), getTeam(fx.b), getPair(fx.a, fx.b)]);
  if (S?.token !== token) return;
  Object.assign(S, { A, B, P });
  if (fx.live) loadRecent(token);
  if (ctx.autoNews) prepareNewsletter(token);
  if (fx.live && Date.parse(fx.start) - Date.now() < 4 * 864e5) ensureSquad();
  // default to a format that has data if the fixture's has none
  renderScope(); renderBody();
  const V = ctx.V;
  (fx.custom && !fx.date ? Promise.resolve({ unavailable: "no-date" }) : getForecast(V?.lat, V?.lon, fx.start, fx.fmt)).then((f) => { if (S?.token === token) { S.forecast = f; if (["overview", "venue"].includes(S.tab)) renderBody(); } });
}

function shell() {
  const { fx, TEAMS, V } = S;
  const name = (c) => TEAMS[c]?.name || c;
  const isHome = (c) => S.V && homeOf(S.V.cc) === c;
  return `
  <div class="d-band"></div>
  <div class="d-scroll" id="dScroll">
    <div class="d-head">
      <div class="d-row">
        <div class="left">${fx.statusLabel && !fx.custom ? `<span class="status ${fx.status}">${esc(fx.statusLabel)}</span>` : ""}<span class="fmt">${esc(fx.fmt)}</span>${fx.custom ? `<span class="fmt">· custom match</span>` : ""}</div>
        <button class="close" data-act="close" aria-label="Close dossier"><svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"/></svg></button>
      </div>
      ${fx.sample ? `<div class="series sample-note">Sample fixture: live fixtures are unavailable, so this match may not be real. The numbers below are real.</div>` : ""}
      ${fx.series ? `<div class="series">${esc(fx.series)}</div>` : ""}
      <div class="matchup">
        <div class="side a"><div class="code" style="color:var(--a)">${esc(fx.a)}</div><div class="name">${esc(name(fx.a))}${isHome(fx.a) ? " · hosts" : ""}</div></div>
        <div class="vs">v</div>
        <div class="side b"><div class="code" style="color:var(--b)">${esc(fx.b)}</div><div class="name">${esc(name(fx.b))}${isHome(fx.b) ? " · hosts" : ""}</div></div>
      </div>
      <div class="facts">
        ${V ? `<span><b>Venue</b>${esc(V.name)}${V.city ? ", " + esc(V.city) : ""}</span>` : `<span><b>Venue</b>Not set</span>`}
        ${fx.custom ? (fx.date ? `<span><b>Date</b>${esc(dmy(fx.date))} <small class="muted">(start time not set; forecast assumes an afternoon start)</small></span>` : "") : `
        ${fx.start && fx.tz && fx.tz !== "Asia/Kolkata" ? `<span><b>Local</b>${fmtTime(fx.start, fx.tz)}</span>` : ""}
        ${fx.start ? `<span><b>IST</b>${fmtTime(fx.start, "Asia/Kolkata")}</span>` : ""}`}
      </div>
      <div class="scope" id="dScope"></div>
    </div>
    <nav class="tabs" role="tablist" aria-label="Dossier sections">
      ${TABS.map(([k, l]) => `<button role="tab" id="t-${k}" data-tab="${k}" aria-selected="${k === S.tab}" ${k === "brief" ? 'class="ai"' : ""}>${l}</button>`).join("")}
    </nav>
    <div class="d-body" id="dBody" role="tabpanel"></div>
  </div>`;
}

const HOME_CC = { IN: "IND", AU: "AUS", GB: "ENG", NZ: "NZ", ZA: "SA", PK: "PAK", LK: "SL", BD: "BAN", ZW: "ZIM", IE: "IRE", AE: "UAE", AF: "AFG", JM: "WI", TT: "WI", BB: "WI", GY: "WI", AG: "WI", LC: "WI", VC: "WI", GD: "WI", DM: "WI", KN: "WI" };
const regionName = (() => { try { const dn = new Intl.DisplayNames(["en"], { type: "region" }); return (cc) => { try { return dn.of(cc); } catch { return null; } }; } catch { return () => null; } })();
export const homeOf = (cc) => {
  if (HOME_CC[cc]) return HOME_CC[cc];
  const name = cc && regionName(cc);
  const t = name && S?.TEAMS && Object.entries(S.TEAMS).find(([, v]) => v.name === name);
  return t ? t[0] : "N";
};
const homeCode = () => { const h = S.V ? homeOf(S.V.cc) : null; return h && h !== "N" && ![S.fx.a, S.fx.b].includes(h) ? "N" : h; };

function renderScope() {
  const has = (f) => (S.P?.matches || []).some((m) => m.f === f) || S.A?.formats?.[f] || S.B?.formats?.[f];
  $("#dScope").innerHTML = `
    <span class="lbl">Stats for</span>
    <div class="seg sm" role="group" aria-label="Format">${FORMATS.map((f) => `<button data-fmt="${f}" aria-pressed="${S.fmt === f}" ${has(f) ? "" : 'disabled style="opacity:.35"'}>${f}${f === S.fx.fmt ? "" : ""}</button>`).join("")}</div>
    <span class="lbl">Period</span>
    <div class="seg sm" role="group" aria-label="Period"><button data-win="all" aria-pressed="${S.win === "all"}">All time</button><button data-win="5y" aria-pressed="${S.win === "5y"}">Last 5 yrs</button></div>`;
}

function bind(el) {
  el.onclick = (e) => {
    const t = e.target.closest("[data-act],[data-tab],[data-fmt],[data-win],[data-pl],[data-side],[data-sq]");
    if (!t || !S || t.closest("#dBody") && S.tab === "matchups" && !t.dataset.act) return;
    if (t.dataset.act === "close") return S.onClose?.();
    if (t.dataset.tab) { S.tab = t.dataset.tab; el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab)); renderBody(); $("#dScroll").scrollTo({ top: $(".tabs").offsetTop, behavior: "smooth" }); return; }
    if (t.dataset.fmt) { S.fmt = t.dataset.fmt; if (S.pp) { S.pp.fmt = S.fmt; S.pp.muFmt = S.fmt; } renderScope(); renderBody(); return; }
    if (t.dataset.win) { S.win = t.dataset.win; renderScope(); renderBody(); return; }
    if (t.dataset.pl) { const id = t.dataset.pl; S.openPl.has(id) ? S.openPl.delete(id) : S.openPl.add(id); renderBody(); return; }
    if (t.dataset.side) { S.muSide = t.dataset.side; renderBody(); return; }
    if (t.dataset.sq) { S.sqShow = t.dataset.sq; renderBody(); return; }
    const act = t.dataset.act;
    if (act === "allres") { S.showAllRes = !S.showAllRes; renderBody(); }
    if (act === "compare") { const [side, id] = t.dataset.id.split(":"); S.pp = { ...(S.pp || { fmt: S.fmt, muFmt: S.fmt, muScope: "squad", muQ: "" }), [side]: id, fmt: S.fmt }; S.tab = "matchups"; el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === "matchups")); renderBody(); $("#dScroll").scrollTo({ top: $(".tabs").offsetTop, behavior: "smooth" }); }
    if (act === "goto-brief") { S.tab = "brief"; el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === "brief")); renderBody(); }
  };
  el.onkeydown = (e) => {
    if (!e.target.matches("[role=tab]") || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tabs = [...el.querySelectorAll("[role=tab]")], i = tabs.indexOf(e.target);
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); n.click();
  };
}

/* ---------- derived data for the current scope ---------- */
function scope() {
  const { fmt, win, A, B, P, meta } = S;
  const built = meta.built;
  const pairAll = (P?.matches || []).filter((m) => m.f === fmt);
  const pair = windowed(pairAll, win, built);
  const ta = A?.formats?.[fmt], tb = B?.formats?.[fmt];
  return {
    built, pairAll, pair,
    teamA: windowed(ta?.matches || [], win, built), teamB: windowed(tb?.matches || [], win, built),
    teamAAll: ta?.matches || [], teamBAll: tb?.matches || [],
    ...squadsFor(ta?.squad || [], tb?.squad || []),
  };
}
// With an announced squad (real fixtures only), limit each side to it and tag pace/spin.
function squadsFor(sa, sb) {
  const t = S.announced;
  if (!t) return { squadA: sa, squadB: sb, extraA: [], extraB: [], announced: false };
  const ta = t.find((x) => x.code === S.fx.a), tb = t.find((x) => x.code === S.fx.b);
  const ra = applyAnnounced(sa, ta), rb = applyAnnounced(sb, tb);
  return { squadA: ra.squad, squadB: rb.squad, extraA: ra.extra, extraB: rb.extra, announced: ra.announced || rb.announced };
}
// Matches since the Cricsheet archive's last update, from Cricbuzz scorecards, merged into form and records.
function loadRecent(token) {
  const fx = S.fx, qs = new URLSearchParams({ a: fx.a, b: fx.b, an: S.TEAMS[fx.a]?.name || fx.a, bn: S.TEAMS[fx.b]?.name || fx.b, fmt: fx.fmt, since: S.meta.built });
  return (S.recentReq = fetch(`api/recent?${qs}`).then((r) => r.json()).catch(() => null).then((j) => {
    if (S?.token !== token || !j?.matches?.length) return;
    const added = [...mergeRecent(S.A, fx.a, fx.fmt, j.matches), ...mergeRecent(S.B, fx.b, fx.fmt, j.matches)];
    if (S.P) for (const m of j.matches) if ([m.a, m.b].includes(fx.a) && [m.a, m.b].includes(fx.b) && !S.P.matches.some((x) => x.id === "cb-" + m.cbMatch || (x.d === m.d && x.f === m.fmt))) S.P.matches.push(compactRecent(m));
    S.P?.matches.sort((x, y) => x.d.localeCompare(y.d));
    const ids = new Set(), list = [];
    for (const m of [...added, ...j.matches]) if (!ids.has(m.cbMatch) && m.fmt === fx.fmt) { ids.add(m.cbMatch); list.push(m); }
    S.fresh = list;
    renderBody();
  }));
}
// One-click newsletter: gather squads, pitch notes and the latest form (each capped at 30 s), then the
// Write tab starts the newsletter by itself; the checklist on screen shows each step.
async function prepareNewsletter(token) {
  ensureSquad(); ensurePitch();
  const cap = (p) => Promise.race([p || Promise.resolve(), new Promise((r) => setTimeout(r, 30000))]);
  renderBody();
  await Promise.all([cap(S.squadReq), cap(S.pitchReq), cap(S.recentReq)]);
  if (S?.token !== token) return;
  S.newsPrep = false; S.autoNews = true;
  renderBody();
}
// Pitch report (Cricbuzz pitch note + series news + web search, written up by Gemini); real fixtures only.
function ensurePitch() {
  const fx = S?.fx, V = S?.V;
  if (!fx?.live || !V || S.pitchReq) return;
  const token = S.token;
  const qs = new URLSearchParams({ a: S.TEAMS[fx.a]?.name || fx.a, b: S.TEAMS[fx.b]?.name || fx.b, ca: fx.a, cb: fx.b, fmt: fx.fmt, start: fx.start || "", venue: V.name, city: V.city || "" });
  S.pitch = "loading";
  S.pitchReq = fetch(`api/pitch?${qs}`).then((r) => r.json()).catch(() => null)
    .then((j) => { if (S?.token !== token) return; S.pitch = j && !j.error ? j : { error: j?.error || "unavailable" }; if (["venue", "brief"].includes(S.tab)) renderBody(); });
}
// Squads cost ~10 CricketData requests, so fetch them only when needed; all matches in a series share one URL (CDN-cached).
function ensureSquad() {
  const fx = S?.fx;
  if (!fx?.live || S.squadReq) return;
  const token = S.token;
  const qs = new URLSearchParams({ id: fx.squadId || fx.id, a: S.TEAMS[fx.a]?.name || fx.a, b: S.TEAMS[fx.b]?.name || fx.b, ca: fx.a, cb: fx.b, fmt: fx.fmt, series: (fx.series || "").split(" · ")[0], start: (fx.start || "").slice(0, 10) });
  S.squadReq = fetch(`api/squad?${qs}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => { if (S?.token !== token) return; S.announced = j?.teams?.length ? j.teams : null; S.squadSource = j?.source; S.PL = null; renderBody(); });
}

function renderBody() {
  if (!S) return;
  const body = $("#dBody");
  if (!S.A && !S.B && !S.P) { body.innerHTML = skeleton(); return; }
  const d = scope();
  body.onclick = null;
  if (["squads", "matchups", "brief"].includes(S.tab)) ensureSquad();
  if (["venue", "brief"].includes(S.tab)) ensurePitch();
  if (S.tab === "matchups") return renderPlayersTab(body, S, d, helpers);
  body.innerHTML = { overview, h2h, venue, squads, brief: () => "" }[S.tab](d);
  if (S.tab === "brief") renderBriefTab(body, S, d, helpers);
}
const skeleton = () => `<div class="sk" style="height:120px"></div><div class="kpis">${'<div class="sk" style="height:76px"></div>'.repeat(4)}</div><div class="sk" style="height:180px"></div>`;

/* ---------- small renderers ---------- */
const nm = (c) => S.TEAMS[c]?.name || c;
const col = (c) => (c === S.fx.a ? "var(--a)" : c === S.fx.b ? "var(--b)" : "var(--fg)");
const tcode = (c) => `<b style="color:${col(c)}">${esc(c)}</b>`;
const venueName = (id) => { const v = S.venues?.[id]; return v ? `${v.name}${v.city ? ", " + v.city : ""}` : id; };

function dbar(a, o, b, p) {
  const w = (x) => (p ? (100 * x) / p : 0);
  return `<div class="dbar"><span class="n ${a > b ? "lead" : ""}">${a}</span><div class="track"><i style="width:${w(a)}%;background:var(--a)"></i><i class="o" style="width:${w(o)}%"></i><i style="width:${w(b)}%;background:var(--b)"></i></div><span class="n ${b > a ? "lead" : ""}">${b}</span></div>`;
}
function scoreLine(m) {
  if (m.f !== "Test") return m.s.map(([t, r, w, ov]) => `${esc(t)} ${r}${w < 10 ? "/" + w : ""} <span class="muted">(${ov})</span>`).join(" · ");
  const by = {};
  for (const [t, r, w, , dec] of m.s) (by[t] ||= []).push(`${r}${w < 10 ? "/" + w : ""}${dec ? "d" : ""}`);
  return Object.entries(by).map(([t, xs]) => `${esc(t)} ${xs.join(" &amp; ")}`).join(" · ");
}
function resultText(m) {
  if (m.res === "W") return `${tcode(m.w)} <span class="muted">by ${esc(m.by)}${m.dl ? " (DLS)" : ""}</span>`;
  return `<span class="muted">${{ D: "Draw", T: "Tied", NR: "No result" }[m.res] || m.res}</span>`;
}
const formChips = (arr) => `<span class="form">${arr.map((r) => `<i class="${r}" title="${r}">${r === "NR" ? "–" : r}</i>`).join("")}</span>`;
const empty = (t) => `<div class="empty">${t}</div>`;
const kpi = (k, v, s) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
const sinceNote = (ms) => (ms.length ? `since ${ms[0].d.slice(0, 4)}` : "");
const winLabel = () => (S.win === "5y" ? "last 5 years" : "all time");
const cricsheetNote = () => `<p class="note">Computed from Cricsheet ball-by-ball records (men's internationals${S.meta?.built ? `, up to ${dmy(S.meta.built)}` : ""})${S.fresh?.length ? `, plus ${S.fresh.length} later match${S.fresh.length > 1 ? "es" : ""} from Cricbuzz scorecards` : ""} and Open-Meteo match-day weather. ${S.fx.a === "AFG" || S.fx.b === "AFG" ? "Cricsheet withholds matches involving Afghanistan, so their records are missing." : ""}</p>`;

export const helpers = { esc, dmy, nm, col, tcode, venueName, scoreLine, resultText, formChips, predictXI, formLine, matchupEdge, venueTrends, teamRecord, formString, h2hRows, batFirstSplit, pct, homeCode, condTags };

/* ---------- layout building blocks: every section is title → one-line takeaway → content ---------- */
const sec = (title, { aside = "", take = "", body = "" } = {}) =>
  `<section class="sec"><div class="sec-h"><h3>${title}</h3>${aside ? `<span class="aside">${aside}</span>` : ""}</div>${take ? `<p class="take">${take}</p>` : ""}${body}</section>`;
const factList = (rows) => `<dl class="flist">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const more = (label, body) => `<details class="more"><summary>${label}</summary><div class="more-body">${body}</div></details>`;
const lead = (a, b, A, B) => (a === b ? `level at <b>${a}–${b}</b>` : `<b>${esc(nm(a > b ? A : B))}</b> lead <b>${Math.max(a, b)}–${Math.min(a, b)}</b>`);

/* ---------- Overview ---------- */
function overview(d) {
  const { fx } = S, A = fx.a, B = fx.b;
  const model = winModel({ A, B, fmt: S.fmt, home: homeCode(), pairMs: d.pairAll, teamA: d.teamAAll, teamB: d.teamBAll, built: d.built });
  const rec = h2hRows(d.pair, A, B, { [A]: nm(A), [B]: nm(B) })[0];
  const last5 = d.pair.slice(-5).map((m) => (m.res === "W" ? (m.w === A ? "W" : "L") : m.res));
  const VF = S.V?.fmt?.[S.fmt];
  return `
  ${sec("Win probability", { aside: `${S.fmt} · model estimate, not odds`, body: model ? winCard(model) : empty(`Not enough ${S.fmt} history between these sides to model a result.`) })}
  ${sec("At a glance", { aside: winLabel(), body: `<div class="kpis">
    ${kpi("Head-to-head", rec.p ? `${rec.a}–${rec.b}` : "—", rec.p ? `${A} v ${B}, ${rec.p} ${S.fmt}s ${sinceNote(d.pair)}` : `No ${S.fmt}s between them`)}
    ${kpi("Last meetings", last5.length ? formChips(last5) : "—", last5.length ? `${A}'s results, oldest first` : "")}
    ${VF?.res ? kpi("Batting first won", `${pct(VF.b1w, VF.res)}%`, `${VF.b1w} of ${VF.res} ${S.fmt}s at this ground`) : kpi("Venue", "—", S.V ? `No ${S.fmt}s here yet` : "No venue set")}
    ${fcKpi(S.forecast)}
  </div>` })}
  ${sec("Key takeaways", { aside: winLabel(), body: takeaways(d) })}
  <button class="cta" data-act="goto-brief"><span>Build the pre-match brief</span><span aria-hidden="true">→</span></button>
  ${cricsheetNote()}`;
}

function winCard(model) {
  const pa = Math.round(model.p * 100), pb = 100 - pa;
  return `<div class="card wp">
    <div class="wp-top"><div><div class="pc" style="color:var(--a)">${pa}%</div><div class="muted">${esc(nm(S.fx.a))}</div></div>
      <div style="text-align:right"><div class="pc" style="color:var(--b)">${pb}%</div><div class="muted">${esc(nm(S.fx.b))}</div></div></div>
    <div class="wp-bar" role="img" aria-label="${S.fx.a} ${pa} percent, ${S.fx.b} ${pb} percent"><i style="width:${pa}%;background:var(--a)"></i><i style="width:${pb}%;background:var(--b)"></i></div>
    ${more("What drives this number", `<div class="factors">${model.factors.map((f) => { const a = Math.round(f.p * 100); return `<div class="factor"><div class="fl">${f.k}<small>${esc(f.sub)}</small></div><div class="wp-bar thin"><i style="width:${a}%;background:var(--a)"></i><i style="width:${100 - a}%;background:var(--b)"></i></div><div class="fv">${a}–${100 - a}</div></div>`; }).join("")}</div>
      <p class="note">Weights used: ${(() => { const tw = model.factors.reduce((s, f) => s + f.w, 0); return model.factors.map((f) => `${f.k.toLowerCase()} ${Math.round((f.w / tw) * 100)}%`).join(" / "); })()}. Small samples are pulled toward 50%.</p>`)}
  </div>`;
}

function fcKpi(fc) {
  if (!S.V) return "";
  if (fc === undefined) return S.V ? `<div class="kpi"><div class="k">Match-day weather</div><div class="sk" style="height:26px;margin-top:4px"></div></div>` : "";
  if (!fc || fc.unavailable) return kpi("Match-day weather", "—", fc?.unavailable === "too-far" ? "Forecast opens 16 days out" : fc?.unavailable === "past" ? "Match date has passed" : fc?.unavailable === "no-date" ? "Pick a date for a forecast" : "Forecast unavailable");
  return kpi("Match-day weather", `${Math.round(fc.tmax)}°`, `${Math.round(fc.rh)}% humidity · ${fc.rainProb}% rain${S.fmt !== "Test" && fc.lateDew >= 18 ? " · dew likely" : ""}`);
}

// One line per topic, same order every time, so the eye learns where to look.
function takeaways(d) {
  const { fx } = S, A = fx.a, B = fx.b, rows = [];
  const hr = h2hRows(d.pair, A, B, { [A]: nm(A), [B]: nm(B) });
  const all = hr[0];
  if (all.p) {
    let t = `${lead(all.a, all.b, A, B)} in ${all.p} ${S.fmt}s ${sinceNote(d.pair)}.`;
    const l5 = d.pair.filter((m) => m.res === "W").slice(-5);
    if (l5.length >= 3) t += ` Last ${l5.length} decisive games: ${A} ${l5.filter((m) => m.w === A).length}, ${B} ${l5.filter((m) => m.w === B).length}.`;
    rows.push(["Head-to-head", t]);
  } else rows.push(["Head-to-head", `No ${S.fmt} meetings in the data.`]);
  const home = homeCode();
  if (home && home !== "N") {
    const r = hr.find((x) => x.group === "Where" && x.label === `In ${nm(home)}`);
    if (r?.p >= 2) rows.push([`In ${esc(nm(home))}`, `${A} <b>${r.a}–${r.b}</b> ${B} from ${r.p} matches.`]);
  }
  const VF = S.V?.fmt?.[S.fmt];
  if (VF?.res >= 3) { const b = pct(VF.b1w, VF.res); rows.push(["This ground", `Sides ${b >= 50 ? "batting first" : "chasing"} win <b>${Math.max(b, 100 - b)}%</b> (${VF.res} results). Average first innings <b>${VF.avg1 ?? "—"}</b>.`]); }
  const fc = S.forecast;
  if (fc?.wx) {
    const k = condTags({ wx: fc.wx, f: S.fmt })[0];
    const c = k && CONDITIONS.find((x) => x.k === k);
    if (c) {
      const r = hr.find((x) => x.label === c.label);
      const ra = teamRecord(d.teamA.filter((m) => condTags(m).includes(k)), A), rb = teamRecord(d.teamB.filter((m) => condTags(m).includes(k)), B);
      rows.push(["Conditions", `Forecast: ${c.label.toLowerCase()}. ${r?.p >= 3 ? `In such matches this fixture is ${A} <b>${r.a}–${r.b}</b> ${B}.` : `Win rate in such ${S.fmt}s: ${A} <b>${pct(ra.w, ra.w + ra.l) ?? "—"}%</b>, ${B} <b>${pct(rb.w, rb.w + rb.l) ?? "—"}%</b>.`}`]);
    } else rows.push(["Conditions", "No weather flags in the forecast."]);
  }
  const top = S.P?.top?.[S.fmt];
  if (top) {
    const inSquad = new Set([...d.squadA, ...d.squadB].map((p) => p.id));
    const bt = top.bat.find((x) => inSquad.has(x[0])), bw = top.bowl.find((x) => inSquad.has(x[0]));
    const bits = [bt && `<b>${esc(bt[1])}</b> ${bt[4]} runs`, bw && `<b>${esc(bw[1])}</b> ${bw[4]} wickets`].filter(Boolean);
    if (bits.length) rows.push(["Rivalry leaders", `${bits.join(" · ")} <span class="muted">(current players)</span>`]);
  }
  const fa = formString(d.teamAAll, A, 5), fb = formString(d.teamBAll, B, 5);
  if (fa.length && fb.length) rows.push(["Form, last 5", `<span class="form-pair"><span>${A} ${formChips(fa)}</span><span>${B} ${formChips(fb)}</span></span>`]);
  return factList(rows);
}

/* ---------- Head-to-head ---------- */
const splitRows = (rs) => `<div class="splits">${rs.map((r) => `<div class="split"><div class="sl">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</div><div>${r.p ? dbar(r.a, r.o, r.b, r.p) : '<div class="pp">No matches</div>'}</div></div>`).join("")}</div>`;
function h2h(d) {
  const { fx } = S, A = fx.a, B = fx.b;
  if (!d.pair.length) return empty(`No ${S.fmt} matches between ${esc(nm(A))} and ${esc(nm(B))} (${winLabel()}). Try another format or "All time".`) + cricsheetNote();
  const rows = h2hRows(d.pair, A, B, { [A]: nm(A), [B]: nm(B) });
  const all = rows[0];
  const bf = batFirstSplit(d.pair), ts = tossSplit(d.pair);
  const g = (name) => rows.filter((r) => r.group === name && r.p);
  const res = d.pair.slice().reverse();
  const shown = S.showAllRes ? res : res.slice(0, 8);
  const legend = `<div class="legend"><span><i style="background:var(--a)"></i>${esc(nm(A))}</span><span><i style="background:var(--b)"></i>${esc(nm(B))}</span><span><i class="o"></i>${S.fmt === "Test" ? "Draw / tie" : "Tie / no result"}</span></div>`;
  return `
  ${sec("Record", { aside: `${S.fmt} · ${winLabel()}`, take: `${lead(all.a, all.b, A, B)} in ${all.p} matches ${sinceNote(d.pair)}. The side batting first won <b>${bf.bf} of ${bf.p}</b>; toss winners won <b>${pc(ts.won, ts.dec)}</b>.`,
    body: `<div class="kpis">${kpi("Played", all.p)}${kpi(`${esc(nm(A))} won`, all.a, `${pct(all.a, all.p)}%`)}${kpi(`${esc(nm(B))} won`, all.b, `${pct(all.b, all.p)}%`)}${kpi(S.fmt === "Test" ? "Drawn / tied" : "Tied / no result", all.o)}</div>` })}
  ${sec("Who wins when", { aside: "wins by situation", body: `<div class="card">${legend}
      <div class="grp">Where it was played</div>${splitRows(rows.filter((r) => r.group === "Where"))}
      <div class="grp">Who batted first</div>${splitRows(g("Innings"))}
      <div class="grp">Who won the toss</div>${splitRows(g("Toss"))}
      ${more("Weather and pitch", `<div class="grp">Match-day weather</div>${g("Conditions").length ? splitRows(g("Conditions")) : '<p class="note">No weather data for these matches.</p>'}
        <div class="grp">Pitch <span class="muted">(by first-innings total: high ≥ ${S.meta.surf[S.fmt][1]}, low &lt; ${S.meta.surf[S.fmt][0]})</span></div>${splitRows(g("Surface"))}`)}
    </div>` })}
  ${sec("Recent results", { aside: `${res.length} ${S.fmt}s`, body: `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Venue</th><th>Result</th><th>Scores</th></tr></thead>
      <tbody>${shown.map((m) => `<tr>
        <td class="num nowrap">${dmy(m.d)}</td>
        <td>${esc(venueName(m.v))}</td>
        <td class="nowrap">${resultText(m)}</td>
        <td>${scoreLine(m)}</td></tr>`).join("")}</tbody>
    </table></div>${res.length > 8 ? `<button class="btn" data-act="allres">${S.showAllRes ? "Show fewer" : `Show all ${res.length}`}</button>` : ""}` })}
  ${topPerformers()}
  ${cricsheetNote()}`;
}

function topPerformers() {
  const top = S.P?.top?.[S.fmt];
  if (!top || (!top.bat.length && !top.bowl.length)) return "";
  const who = (x) => `${esc(x[1])} <span class="muted">${esc(x[2])}</span>`;
  return sec("Rivalry leaders", { aside: `all ${S.fmt}s in this fixture`, body: `<div class="grid2">
    <div class="card"><table class="tbl"><thead><tr><th>Most runs</th><th class="r">M</th><th class="r">Runs</th><th class="r">Avg</th><th class="r">SR</th></tr></thead><tbody>
      ${top.bat.slice(0, 5).map((x) => `<tr><td>${who(x)}</td><td class="r num">${x[3]}</td><td class="r num"><b>${x[4]}</b></td><td class="r num">${x[5] ?? "—"}</td><td class="r num">${x[6] ?? "—"}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><table class="tbl"><thead><tr><th>Most wickets</th><th class="r">M</th><th class="r">Wkts</th><th class="r">Avg</th><th class="r">Econ</th></tr></thead><tbody>
      ${top.bowl.slice(0, 5).map((x) => `<tr><td>${who(x)}</td><td class="r num">${x[3]}</td><td class="r num"><b>${x[4]}</b></td><td class="r num">${x[5] ?? "—"}</td><td class="r num">${x[6] ?? "—"}</td></tr>`).join("")}</tbody></table></div>
  </div>` });
}

/* ---------- Venue & conditions ---------- */
function venue(d) {
  const V = S.V, A = S.fx.a, B = S.fx.b;
  if (!V) return empty('No venue set for this match. Pick one from "Any match" to see ground stats and the forecast.') + teamSplitsTable(d) + cricsheetNote();
  const F = V.fmt?.[S.fmt];
  const trends = venueTrends(V, S.fmt, S.meta.built);
  const counts = Object.entries(V.fmt).map(([f, x]) => `${x.p} ${f}${x.p > 1 ? "s" : ""}`).join(" · ");
  const parts = [];
  parts.push(sec(esc(V.name), { aside: `${esc(V.city || "")} · ${counts}`,
    body: F ? `<div class="kpis">
      ${kpi("Avg first innings", F.avg1 ?? "—", F.avg2 ? `second innings ${F.avg2}` : "")}
      ${kpi("Batting first won", pc(F.b1w, F.res), F.res ? `${F.b1w} of ${F.res} results` : "no results yet")}
      ${kpi("Toss winners bat", pc(F.tossBat, F.toss), F.tossDec ?? F.toss ? `and win ${pc(F.tossWon, F.tossDec ?? F.toss)}` : "")}
      ${F.hi ? kpi("Highest total", `${F.hi[0]}/${F.hi[1]}`, `${esc(F.hi[2])}, ${F.hi[3].slice(0, 4)}`) : ""}
    </div>` : empty(`No ${S.fmt}s at this ground in the data.`) }));
  parts.push(pitchSection(F));
  if (trends.length) parts.push(sec("Three venue trends", { aside: "most unusual first", body: `<ol class="numbered">${trends.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` }));
  parts.push(conditionsSection(F));
  if (F?.ph?.[0] && S.fmt !== "Test") {
    const L = S.fmt === "T20I" ? ["Powerplay · 1–6", "Middle · 7–15", "Death · 16–20"] : ["Powerplay · 1–10", "Middle · 11–40", "Death · 41–50"];
    parts.push(sec("Scoring by phase", { aside: "runs per over · wickets per 10 overs", body: `<div class="phases">${F.ph.map((p, i) => (p ? `<div class="phase"><div class="k">${L[i]}</div><div class="v">${p[0]}</div><div class="s">${p[1]} wkts / 10 ov</div></div>` : "")).join("")}</div>` }));
  }
  parts.push(teamSplitsTable(d));
  const here = d.pairAll.filter((m) => m.v === V.id);
  if (here.length) parts.push(sec(`${A} v ${B} here`, { aside: `${here.length} ${S.fmt}${here.length > 1 ? "s" : ""}`, body: `<div class="card"><table class="tbl"><tbody>
    ${here.slice().reverse().map((m) => `<tr><td class="num nowrap">${dmy(m.d)}</td><td class="nowrap">${resultText(m)}</td><td>${scoreLine(m)}</td></tr>`).join("")}</tbody></table></div>` }));
  parts.push(cricsheetNote());
  return parts.join("");
}

// What is being said about the pitch (sourced), then what the ground's numbers say.
function pitchSection(F) {
  const P = S.pitch, r = P?.report;
  const numbers = F ? `Average first innings <b>${F.avg1 ?? "—"}</b>${F.avg2 ? `, second <b>${F.avg2}</b>` : ""}; sides batting first won <b>${pct(F.b1w, F.res) ?? "—"}%</b> of ${F.res} results${F.ph?.[2] && S.fmt !== "Test" ? `; death overs go at <b>${F.ph[2][0]}</b> an over` : ""}.` : "";
  const fav = { batting: "Batting", pace: "Pace bowling", spin: "Spin bowling", balanced: "Even contest" }[r?.favours];
  const rows = [];
  if (r?.summary) rows.push(["This match", esc(r.summary)]);
  if (r?.surface) rows.push(["Surface", esc(r.surface)]);
  if (fav) rows.push(["Likely to help", fav]);
  if (r?.expectedScore) rows.push(["Expected score", esc(r.expectedScore)]);
  if (r?.dew) rows.push(["Dew and toss", esc(r.dew)]);
  if (r?.teamNews) rows.push(["Team news", esc(r.teamNews)]);
  if (r?.seriesPattern) rows.push(["Earlier in the series", esc(r.seriesPattern)]);
  if (numbers) rows.push(["The numbers here", numbers]);
  let take = "";
  if (!S.fx.live) take = "Pitch reports are gathered for scheduled fixtures. For this match, here is how the ground has played.";
  else if (P === "loading" || P === undefined) take = "Gathering the latest pitch notes from Cricbuzz and the web…";
  else if (P?.error) take = `Couldn't gather pitch notes right now (${esc(P.error.slice(0, 120))}).`;
  else if (!r?.summary) take = "No pitch report for this match has been published yet; previews usually appear the day before. Meanwhile:";
  const quotes = r?.quotes?.length ? `<ul class="notes">${r.quotes.slice(0, 3).map((q) => `<li>“${esc(q.text)}” <span class="muted">— ${esc(q.who)}${q.outlet ? `, ${esc(q.outlet)}` : ""}</span></li>`).join("")}</ul>` : "";
  const src = P?.notes?.length ? `<p class="note">Sources: ${P.notes.slice(0, 6).map((n) => `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title || n.kind)}</a>${n.at ? ` (${esc(n.at)})` : ""}`).join(" · ")}</p>` : "";
  return sec("Pitch report", { aside: P?.notes?.length ? "from Cricbuzz and the web, summarised by Gemini" : "", take, body: (P === "loading" ? `<div class="sk" style="height:70px"></div>` : "") + (rows.length ? factList(rows) : "") + quotes + src });
}

// Forecast tiles show the typical value at this ground underneath, so "is this unusual?" is answered in place.
function conditionsSection(F) {
  const fc = S.forecast, typ = F?.wx; // typ: [tmax, rh, cloud, dew, rain]
  if (fc === undefined) return sec("Match-day conditions", { body: `<div class="sk" style="height:84px"></div>` });
  if (!fc || fc.unavailable) {
    const msg = fc?.unavailable === "too-far" ? "The forecast opens 16 days before the match. Typical values at this ground:" : fc?.unavailable === "past" ? "This match date has passed." : fc?.unavailable === "no-date" ? "No match date set, so no forecast. Typical values at this ground:" : "Forecast unavailable right now.";
    return sec("Match-day conditions", { take: msg, body: typ ? `<div class="wx">${tile("Max temp", `${typ[0]}°`)}${tile("Humidity", `${typ[1]}%`)}${tile("Cloud", `${typ[2]}%`)}${tile("Dew point", `${typ[3]}°`)}</div>` : "" });
  }
  const notes = [];
  if (S.fmt !== "Test" && fc.lateDew >= 18) notes.push(`<b>Dew likely</b> in the second innings (dew point ${Math.round(fc.lateDew)} °C). Favours the chasing side.`);
  if (fc.rainProb >= 40) notes.push(`<b>Rain risk ${fc.rainProb}%</b>${fc.rain >= 1 ? `, about ${fc.rain.toFixed(1)} mm` : ""}. DLS could come into play.`);
  if (fc.cloud >= 60) notes.push(`<b>Overcast</b> (${Math.round(fc.cloud)}% cloud). Helps swing bowling.`);
  if (fc.tmax >= 33) notes.push(`<b>Hot</b> (${Math.round(fc.tmax)} °C). The surface should dry out and wear faster.`);
  if (fc.wind >= 30) notes.push(`<b>Windy</b>, gusts to ${Math.round(fc.wind)} km/h. Bowling ends matter.`);
  const dew = Math.round(S.fmt === "Test" ? fc.dew : fc.lateDew);
  return sec("Match-day conditions", { aside: "live forecast · typical here underneath",
    take: notes.length ? "" : "No weather flags for this match.",
    body: `<div class="wx">
      ${tile("Max temp", `${Math.round(fc.tmax)}°`, typ && `${typ[0]}°`)}
      ${tile("Humidity", `${Math.round(fc.rh)}%`, typ && `${typ[1]}%`)}
      ${tile("Rain chance", `${fc.rainProb}%`, typ && `${typ[4]} mm`)}
      ${tile("Cloud", `${Math.round(fc.cloud)}%`, typ && `${typ[2]}%`)}
      ${tile("Dew point", `${dew}°`, typ && `${typ[3]}°`)}
    </div>${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}` });
}
const tile = (k, v, typical) => `<div><div class="k">${k}</div><div class="v">${v}</div>${typical ? `<div class="t">typical ${typical}</div>` : ""}</div>`;

function teamSplitsTable(d) {
  const A = S.fx.a, B = S.fx.b;
  if (!d.teamA.length && !d.teamB.length) return "";
  const ra = teamRows(d.teamA, A), rb = teamRows(d.teamB, B);
  const fcTags = S.forecast?.wx ? condTags({ wx: S.forecast.wx, f: S.fmt }) : [];
  const isFc = (r) => fcTags.includes(CONDITIONS.find((c) => c.label === r.label)?.k);
  const cell = (r) => (r?.p ? `<b class="num">${pct(r.w, r.w + r.l) ?? "—"}%</b> <span class="muted num">${r.w}–${r.l}</span>` : '<span class="muted">—</span>');
  const rows = ra.map((r, i) => ({ ...r, other: rb[i] })).filter((r) => r.p || r.other?.p);
  const key = rows.filter((r) => ["Overall", "Where", "Innings"].includes(r.group) || isFc(r));
  const rest = rows.filter((r) => !key.includes(r));
  const table = (rs) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>${esc(nm(A))}</th><th>${esc(nm(B))}</th></tr></thead><tbody>
    ${rs.map((r) => `<tr><td>${esc(r.label)}${isFc(r) ? ' <span class="cond">forecast</span>' : ""}</td><td>${cell(r)}</td><td>${cell(r.other)}</td></tr>`).join("")}</tbody></table></div>`;
  return sec("Each side's win rate", { aside: `${S.fmt}s against everyone · ${winLabel()}`, body: `<div class="card">${table(key)}${rest.length ? more("Toss, weather and pitch", table(rest)) : ""}</div>` });
}

/* ---------- Squads & form ---------- */
function squads(d) {
  const A = S.fx.a, B = S.fx.b;
  if (!d.squadA.length && !d.squadB.length) return empty(`No recent ${S.fmt} squads in the data.`);
  const pa = predictXI(d.squadA, S.fmt, { opp: B, teamLast: d.teamAAll.at(-1)?.d }), pb = predictXI(d.squadB, S.fmt, { opp: A, teamLast: d.teamBAll.at(-1)?.d });
  const xiA = new Set(pa.map((x) => x.p.id)), xiB = new Set(pb.map((x) => x.p.id));
  // the predicted XIs up front: eleven names per side, each with its one-line reason
  const xiList = (side, code, xi) => `<div class="pxi ${side}"><h4 style="color:var(--${side})">${esc(nm(code))}</h4>${xi.length ? `<ol>${xi.map((x) => `<li><b>${esc(x.p.n)}</b> <span class="role">${x.p.role}</span><small>${esc(x.reason)}</small></li>`).join("")}</ol>` : `<p class="muted">Not enough recent ${S.fmt}s to pick an XI.</p>`}</div>`;
  return `
  ${sec("Predicted XI", { aside: d.announced ? "picked from the announced squads" : "picked from recent squads", body: `<div class="pxi-grid">${xiList("a", A, pa)}${xiList("b", B, pb)}</div>` })}
  <div class="seg sm team-switch" role="group" aria-label="Team"><button data-sq="a" aria-pressed="${S.sqShow === "a"}">${esc(nm(A))}</button><button data-sq="b" aria-pressed="${S.sqShow === "b"}">${esc(nm(B))}</button></div>
  ${S.fresh?.length ? `<p class="note" style="margin:0">Form includes ${S.fresh.length} match${S.fresh.length > 1 ? "es" : ""} since ${dmy(S.meta.built)} from Cricbuzz scorecards: ${S.fresh.map((m) => `${esc(m.desc)} (${dmy(m.d)})`).join(", ")}.</p>` : ""}
  <p class="take">${d.announced ? `<b>Announced squads</b> (${{ backup: "found by Gemini with Google Search", cricbuzz: `Cricbuzz, ${S.fmt} squad`, cricketdata: "CricketData.org, full tour squad" }[S.squadSource] || "announced"}), with our records for each player.` : S.fx.live ? "Loading the announced squads…" : `Players used in each side's last 8 ${S.fmt}s.`} <span class="xi">XI</span> = predicted playing XI. Bars show the last five innings (runs, or wickets for bowlers). Tap a player for details.</p>
  <details class="more"><summary>How the predicted XI is picked</summary><div class="more-body">
    <p class="note" style="margin:0">Every squad player gets a selection score out of 100:</p>
    <table class="tbl"><tbody>${RUBRIC.map(([k, w, t]) => `<tr><td><b>${k}</b></td><td class="r num">${w}</td><td class="muted">${t}</td></tr>`).join("")}</tbody></table>
    <p class="note" style="margin:0">Then the XI is built from the highest scores with balance rules: exactly one keeper, at least five bowling options, ${S.fmt === "Test" ? "four to five" : "three to five"} specialist bowlers and no more than seven specialist batters. Batting order follows each player's usual position. Gemini only changes the XI when news reports an injury or a confirmed change.</p>
  </div></details>
  <div class="squads" data-show="${S.sqShow}">
    ${squadCol("a", A, B, d.squadA, xiA, d.extraA)}
    ${squadCol("b", B, A, d.squadB, xiB, d.extraB)}
  </div>`;
}

function squadCol(side, code, opp, squad, xi, extra = []) {
  const order = { WK: 1, BAT: 0, AR: 2, BOWL: 3 };
  const list = squad.slice().sort((x, y) => (xi.has(y.id) - xi.has(x.id)) || (order[x.role] - order[y.role]) || ((x.career.pos ?? 12) - (y.career.pos ?? 12)));
  return `<div class="squad ${side}"><h4><span style="color:var(--${side})">${esc(nm(code))}</span><small>${squad.length} players</small></h4>
    <div class="pl">${list.map((p) => playerRow(p, side, code, opp, xi.has(p.id))).join("")}</div>
    ${extra.length ? `<p class="note">Also in the announced squad, no recent ${S.fmt}s in our records: ${extra.map((x) => `${esc(x.name)}${x.role ? ` <span class="muted">(${esc(x.role)})</span>` : ""}`).join(", ")}.</p>` : ""}</div>`;
}

function playerRow(p, side, code, opp, inXI) {
  const bowler = p.role === "BOWL";
  const y = p.y1;
  // one hue per team; stronger shade = bigger contribution
  const tc = (lvl) => (lvl === 2 ? `var(--${side})` : lvl === 1 ? `color-mix(in srgb, var(--${side}) 50%, transparent)` : "rgba(170,190,230,.2)");
  const stat = bowler ? (y.w || y.bb ? `${y.w} wkts · econ ${y.econ ?? "—"}` : "no games in 12 mo") : y.inn ? `${y.r} runs · SR ${y.sr ?? "—"}` : "no games in 12 mo";
  const bars = bowler ? p.bowl5.map((x) => ({ v: x[4], lab: x[4], max: 5, c: tc(x[4] >= 3 ? 2 : x[4] ? 1 : 0), t: `${x[4]}/${x[3]} (${x[2]} ov) v ${x[1]}, ${dmy(x[0])}` }))
    : p.bat5.map((x) => ({ v: x[2], lab: x[2] + (x[4] ? "" : "*"), max: S.fmt === "Test" ? 150 : S.fmt === "ODI" ? 100 : 75, c: tc(x[2] >= (S.fmt === "T20I" ? 40 : 50) ? 2 : x[2] >= (S.fmt === "T20I" ? 20 : 25) ? 1 : 0), t: `${x[2]}${x[4] ? "" : "*"} (${x[3]}b) v ${x[1]}, ${dmy(x[0])}` }));
  const open = S.openPl.has(p.id);
  return `<div class="pr ${open ? "open" : ""}">
    <button data-pl="${esc(p.id)}" aria-expanded="${open}">
      <span class="pn">${inXI ? '<span class="xi">XI</span>' : ""}<span class="nm">${esc(p.n)}</span><span class="role">${p.role}${p.type && (p.role === "BOWL" || p.role === "AR") ? " · " + p.type : ""}</span></span>
      <span class="ps">${stat}</span>
      <span class="last5" aria-label="Last five: ${bars.map((b) => b.t).join("; ")}"><span class="lbl">${bowler ? "WKT" : "RUNS"}</span>${bars.length ? bars.map((b) => `<i style="height:${Math.max(3, Math.min(100, (b.v / b.max) * 100))}%;--c:${b.c}" title="${esc(b.t)}"><b>${esc(b.lab)}</b></i>`).join("") : '<span class="muted" style="font-size:11px">No recent innings</span>'}</span>
    </button>
    ${open ? playerDetail(p, side, code, opp) : ""}
  </div>`;
}

function playerDetail(p, side, code, opp) {
  const c = p.career, y = p.y1, v = p.vs?.[opp];
  const row = (k, a, b) => `<tr><td class="muted">${k}</td><td class="r num">${a ?? "—"}</td><td class="r num">${b ?? "—"}</td></tr>`;
  const vsTxt = v ? [v[1] ? `${v[2]} runs in ${v[1]} inns${v[4] ? `, avg ${(v[2] / v[4]).toFixed(1)}` : ""}${v[3] ? `, SR ${Math.round((100 * v[2]) / v[3])}` : ""}` : "", v[5] ? `${v[7]} wkts, econ ${((v[6] / v[5]) * 6).toFixed(1)}` : ""].filter(Boolean).join(" · ") : "";
  const ph = S.fmt === "Test" ? "" : `<tr><td class="muted">SR by phase</td><td class="r num" colspan="2">${(c.phBat || []).map((x) => x ?? "–").join(" / ")} <span class="muted">PP / mid / death</span></td></tr>
    ${c.phBowl?.some(Boolean) ? `<tr><td class="muted">Econ by phase</td><td class="r num" colspan="2">${c.phBowl.map((x) => (x ? x[0] : "–")).join(" / ")}</td></tr>` : ""}`;
  const sc = selectionScore(p, S.fmt, { opp, teamLast: (code === S.fx.a ? scope().teamAAll : scope().teamBAll).at(-1)?.d });
  return `<div class="pdetail">
    <div class="muted">${esc(formLine(p))}</div>
    <div class="selscore"><b>Selection score ${sc.total}/100</b><span>${RUBRIC.map(([k, w], i) => `${k.replace("Record v opponent", "v " + opp).replace("Selection continuity", "Continuity")} ${Math.round(sc.parts[i])}/${w}`).join(" · ")}</span></div>
    <table class="tbl"><thead><tr><th>${S.fmt}</th><th class="r">Career*</th><th class="r">Last 12 mo</th></tr></thead><tbody>
      ${row("Matches", c.m, y.m)}
      ${c.inn ? row("Runs", c.r, y.r) + row("Average", c.avg, y.avg) + row("Strike rate", c.sr, y.sr) + row("High score", c.hs, y.hs) + row("50s / 100s", `${c.c50} / ${c.c100}`, `${y.c50} / ${y.c100}`) : ""}
      ${c.bb ? row("Wickets", c.w, y.w) + row("Bowl avg", c.bavg, y.bavg) + row("Economy", c.econ, y.econ) + row("Best", c.best, y.best) : ""}
      ${c.st || c.ct ? row("Catches / stumpings", `${c.ct} / ${c.st}`, `${y.ct} / ${y.st}`) : ""}
      ${ph}
    </tbody></table>
    ${vsTxt ? `<div><span class="mono muted" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">v ${esc(opp)} · ${v[0]} matches</span><br>${esc(vsTxt)}</div>` : ""}
    ${p.bat5.length ? `<div><span class="mono muted" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">Last ${p.bat5.length} innings</span><br>${p.bat5.slice().reverse().map((x) => `<b>${x[2]}${x[4] ? "" : "*"}</b> <span class="muted">(${x[3]}) v ${esc(x[1])}, ${dmy(x[0])}</span>`).join("<br>")}</div>` : ""}
    ${p.bowl5.length && p.role !== "BAT" ? `<div><span class="mono muted" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">Last ${p.bowl5.length} spells</span><br>${p.bowl5.slice().reverse().map((x) => `<b>${x[4]}/${x[3]}</b> <span class="muted">(${x[2]} ov) v ${esc(x[1])}, ${dmy(x[0])}</span>`).join("<br>")}</div>` : ""}
    <div class="acts"><button class="btn" data-act="compare" data-id="${side}:${esc(p.id)}">Full profile and comparison →</button></div>
    <p class="note" style="margin:0">*Career = ${S.fmt}s in Cricsheet records.</p>
  </div>`;
}
