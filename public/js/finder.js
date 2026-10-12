// "Find any match": search every men's international pairing (from data/pairs-index.json) and upcoming fixtures.
// Step 1 lists matches for the query; step 2 picks format (and optionally venue/date) and opens the dossier.
import { getJSON } from "./data.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FMTS = ["T20I", "ODI", "Test"];
// nicknames people actually type
const ALIASES = { windies: "WI", "west indies": "WI", proteas: "SA", kiwis: "NZ", "black caps": "NZ", aussies: "AUS", "team india": "IND", "men in blue": "IND", "three lions": "ENG", tigers: "BAN", "sri": "SL", "papua": "PNG", "uae": "UAE", "emirates": "UAE", "america": "USA", "us": "USA", "holland": "NED", "dutch": "NED", "afghan": "AFG" };

let deps, index = null, step = null, active = 0, items = [], presetVenue = null;

export function initFinder(d) {
  deps = d;
  const dlg = $("#finder"), q = $("#fdQ");
  $("#findBtn").onclick = open;
  $("#fdClose").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click outside
  addEventListener("keydown", (e) => {
    if (e.key === "/" && !dlg.open && !/input|textarea|select/i.test(document.activeElement?.tagName)) { e.preventDefault(); open(); }
  });
  q.addEventListener("input", () => { step = null; active = 0; render(); });
  q.addEventListener("keydown", (e) => {
    if (step) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, Math.min(items.length - 1, active + (e.key === "ArrowDown" ? 1 : -1))); highlight(); }
    if (e.key === "Enter" && items[active]) { e.preventDefault(); choose(items[active]); }
  });
  $("#fdBody").addEventListener("click", (e) => {
    const r = e.target.closest("[data-i]"); if (r) return choose(items[+r.dataset.i]);
    const t = e.target.closest("[data-act]"); if (!t) return;
    if (t.dataset.act === "back") { step = null; render(); q.focus(); }
    if (t.dataset.act === "fmt") { step.fmt = t.dataset.f; renderStep(); }
    if (t.dataset.act === "go") go();
  });
}

export function openFinder(query = "", venueId = null) { return open(query, venueId); }
async function open(query = "", venueId = null) {
  const dlg = $("#finder");
  step = null; active = 0; presetVenue = typeof venueId === "string" ? venueId : null;
  $("#fdQ").value = typeof query === "string" ? query : "";
  dlg.showModal();
  $("#fdQ").focus();
  if (!index) { $("#fdBody").innerHTML = `<div class="sk" style="height:200px;margin:12px"></div>`; index = await getJSON("data/pairs-index.json").catch(() => []); }
  render();
}

/* ---------- matching ---------- */
function teamMatches(token) {
  const t = token.trim().toLowerCase();
  if (!t) return [];
  const teams = deps.teams();
  const out = [];
  if (ALIASES[t] && teams[ALIASES[t]]) out.push([ALIASES[t], 100]);
  for (const [code, v] of Object.entries(teams)) {
    const n = v.name.toLowerCase();
    let sc = 0;
    if (code.toLowerCase() === t) sc = 90;
    else if (n === t) sc = 95;
    else if (n.startsWith(t)) sc = 70;
    else if (n.split(/\s+/).some((w) => w.startsWith(t))) sc = 55;
    else if (t.length >= 3 && n.includes(t)) sc = 40;
    if (sc) out.push([code, sc + (v.major ? 5 : 0) + Math.min(5, ((v.n?.T20I || 0) + (v.n?.ODI || 0) + (v.n?.Test || 0)) / 100)]);
  }
  const best = new Map();
  for (const [c, s] of out) best.set(c, Math.max(best.get(c) || 0, s));
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
const pairRow = (a, b) => index.find((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
const total = (p) => p[2] + p[3] + p[4];

function search(qs) {
  const fixtures = deps.fixtures();
  const res = [];
  // a CricketData match ID, e.g. 3c451481-9fa8-400b-a7b6-27cffc21e1a8
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qs.trim())) return [{ kind: "id", id: qs.trim().toLowerCase() }];
  const parts = qs.split(/\s+(?:v|vs|v\.|versus|and|x|against)\s+|\s*[-–—]\s*/i).filter(Boolean);
  if (!qs.trim()) {
    for (const f of fixtures.filter((f) => f.status !== "done").slice(0, 4)) res.push({ kind: "fixture", f });
    for (const p of index.filter((p) => deps.teams()[p[0]] && deps.teams()[p[1]]).slice(0, 6)) res.push({ kind: "pair", a: p[0], b: p[1], p, hint: "played recently" });
    return res;
  }
  if (parts.length >= 2) {
    const A = teamMatches(parts[0]).slice(0, 4), B = teamMatches(parts[1]).slice(0, 4);
    for (const a of A) for (const b of B) if (a !== b) res.push({ kind: "pair", a, b, p: pairRow(a, b) });
  } else {
    const T = teamMatches(parts[0] || qs);
    for (const t of T.slice(0, 2)) {
      // that team's fixtures first, then its most-played opponents
      for (const f of fixtures.filter((f) => f.a === t || f.b === t)) res.push({ kind: "fixture", f });
      const opps = index.filter((p) => p[0] === t || p[1] === t).sort((x, y) => total(y) - total(x)).slice(0, 8);
      for (const p of opps) res.push({ kind: "pair", a: t, b: p[0] === t ? p[1] : p[0], p });
    }
  }
  // de-duplicate, real meetings first
  const seen = new Set();
  const uniq = res.filter((r) => { const k = r.kind === "fixture" ? "f" + r.f.id : [r.a, r.b].sort().join("-"); if (seen.has(k)) return false; seen.add(k); return true; });
  // fixtures first, then pairings that have met (most meetings first), then ones that never have
  const rank = (r) => (r.kind === "fixture" ? 0 : r.p ? 1 : 2);
  return uniq.map((r, i) => [r, i]).sort(([x, i], [y, j]) => rank(x) - rank(y) || (x.p && y.p && parts.length < 2 ? total(y.p) - total(x.p) : i - j)).map(([r]) => r).slice(0, 12);
}

/* ---------- step 1: results ---------- */
function render() {
  const body = $("#fdBody");
  if (!index) return;
  if (step) return renderStep();
  const qs = $("#fdQ").value;
  items = search(qs);
  const T = deps.teams();
  const name = (c) => esc(T[c]?.name || c);
  const meet = (p) => (p ? FMTS.map((f, i) => (p[2 + i] ? `${p[2 + i]} ${f}${p[2 + i] > 1 ? "s" : ""}` : "")).filter(Boolean).join(" · ") + ` · last met ${new Date(p[5]).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : "No previous meetings in the data");
  if (!items.length) {
    body.innerHTML = `<p class="fd-empty">No team matches “${esc(qs)}”. Try a country name, e.g. <b>Nepal</b>, or two teams: <b>Scotland v Netherlands</b>.</p>`;
    return;
  }
  const head = !qs.trim() ? `<div class="fd-h">Upcoming and recent</div>` : "";
  body.innerHTML = head + `<ul class="fd-list" role="listbox">${items.map((r, i) => r.kind === "id"
    ? `<li role="option" data-i="${i}" class="fd-row on"><span class="fd-k">Match ID</span><span class="fd-t"><b>Open match ${esc(r.id.slice(0, 8))}…</b><small>Looks it up on CricketData.org</small></span></li>`
    : r.kind === "fixture"
    ? `<li role="option" data-i="${i}" class="fd-row${i === active ? " on" : ""}"><span class="fd-k">Fixture</span><span class="fd-t"><b>${name(r.f.a)} v ${name(r.f.b)}</b><small>${esc(r.f.fmt)} · ${esc(r.f.statusLabel || "")}${r.f.V ? ` · ${esc(r.f.V.name)}` : ""}</small></span></li>`
    : `<li role="option" data-i="${i}" class="fd-row${i === active ? " on" : ""}"><span class="fd-k">${r.p ? "Matchup" : "New"}</span><span class="fd-t"><b>${name(r.a)} v ${name(r.b)}</b><small>${meet(r.p)}</small></span></li>`).join("")}</ul>
    <p class="fd-foot">Every men's international since Dec 2001 (T20Is since 2005). ↑ ↓ to move, Enter to open.</p>`;
}
function highlight() { document.querySelectorAll(".fd-row").forEach((r, i) => r.classList.toggle("on", i === active)); document.querySelector(".fd-row.on")?.scrollIntoView({ block: "nearest" }); }

function choose(r) {
  if (!r) return;
  if (r.kind === "fixture") { $("#finder").close(); return deps.openFixture(r.f); }
  if (r.kind === "id") { $("#finder").close(); return deps.openMatchId(r.id); }
  const p = r.p;
  const fmt = p ? FMTS[[p[2], p[3], p[4]].indexOf(Math.max(p[2], p[3], p[4]))] : "T20I";
  step = { a: r.a, b: r.b, p, fmt };
  renderStep();
}

/* ---------- step 2: format, venue, date ---------- */
function renderStep() {
  const { a, b, p, fmt } = step, T = deps.teams();
  const venues = Object.values(deps.venues()).filter((v) => v.cc && Object.values(v.fmt).some((f) => f.p >= 2)).sort((x, y) => x.name.localeCompare(y.name));
  $("#fdBody").innerHTML = `<div class="fd-step">
    <button class="btn" data-act="back">← Back to results</button>
    <h3>${esc(T[a]?.name)} <span class="muted">v</span> ${esc(T[b]?.name)}</h3>
    <p class="muted">${p ? FMTS.map((f, i) => `${p[2 + i]} ${f}${p[2 + i] === 1 ? "" : "s"}`).join(" · ") : "They haven't met in the data yet; you'll still get each side's form, squads and players."}</p>
    <div class="fd-field"><span>Format</span><div class="seg sm">${FMTS.map((f, i) => `<button data-act="fmt" data-f="${f}" aria-pressed="${fmt === f}"${T[a]?.n?.[f] || T[b]?.n?.[f] ? "" : " disabled style=\"opacity:.35\""}>${f}${p ? ` <small class="muted">${p[2 + i]}</small>` : ""}</button>`).join("")}</div></div>
    <label class="fd-field"><span>Venue <small class="muted">optional, sets home/away and the forecast</small></span><input id="fdV" list="fdVenues" placeholder="Search grounds, e.g. Grange Cricket Club" autocomplete="off" value="${presetVenue && deps.venues()[presetVenue] ? esc(`${deps.venues()[presetVenue].name}, ${deps.venues()[presetVenue].city || ""}`) : ""}"><datalist id="fdVenues">${venues.map((v) => `<option value="${esc(`${v.name}, ${v.city || ""}`)}">`).join("")}</datalist></label>
    <label class="fd-field"><span>Match date <small class="muted">optional</small></span><input id="fdD" type="date"></label>
    <button class="cta" data-act="go"><span>Open the dossier</span><span aria-hidden="true">→</span></button>
  </div>`;
}
function go() {
  const vIn = $("#fdV").value.trim();
  const v = Object.values(deps.venues()).find((x) => `${x.name}, ${x.city || ""}` === vIn);
  $("#finder").close();
  deps.openCustom({ a: step.a, b: step.b, fmt: step.fmt, venue: v?.id, date: $("#fdD").value || null });
}
