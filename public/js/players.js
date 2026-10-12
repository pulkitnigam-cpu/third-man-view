// Players tab: pick any two players from dropdowns, compare the numbers that matter for their roles,
// see whether they've faced each other, and open extra detail only when asked.
import { getJSON } from "./data.js";

const FMTS = ["T20I", "ODI", "Test"];
const r1 = (x) => Math.round(x * 10) / 10;
const sum = (a, b) => (a || 0) + (b || 0);
const loadPlayers = (code) => getJSON(`data/players/${code}.json`).catch(() => ({ players: [] }));
const ROLE_ORDER = ["BAT", "WK", "AR", "BOWL"];

/* ---------- combining formats ---------- */
const addArr = (a = [], b = []) => (a.length >= b.length ? a : b).map((_, i) => sum(a[i], b[i]));
const addMap = (a = {}, b = {}) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = Array.isArray(v) ? addArr(o[k], v) : sum(o[k], v); return o; };
const better = (x, y, cmp) => (!x ? y : !y ? x : cmp(x, y) ? x : y);
const parseFig = (s) => { if (!s) return null; const [w, r] = s.split("/").map(Number); return { s, w, r }; };
const parseHS = (s) => (s == null ? null : { s, v: parseInt(s, 10) + (String(s).endsWith("*") ? 0.5 : 0) });

function combine(profiles) {
  const ps = profiles.filter(Boolean);
  if (ps.length <= 1) return ps[0] || null;
  let bat = null, bowl = null;
  for (const p of ps) {
    if (p.bat) {
      const x = p.bat;
      bat = bat ? {
        inn: bat.inn + x.inn, no: bat.no + x.no, r: bat.r + x.r, b: bat.b + x.b, c100: bat.c100 + x.c100, c50: bat.c50 + x.c50, z: bat.z + x.z, f: bat.f + x.f, s: bat.s + x.s,
        _d: bat._d + (x.dot * x.b) / 100, _pos: bat._pos + x.pos * x.inn, hs: better(parseHS(bat.hs), parseHS(x.hs), (a, b) => a.v >= b.v)?.s,
        how: addMap(bat.how, x.how), sp: addMap(bat.sp, x.sp), vs: addMap(bat.vs, x.vs), ph: null, last: [...bat.last, ...x.last].sort((a, b) => a[0].localeCompare(b[0])).slice(-10),
      } : { ...x, _d: (x.dot * x.b) / 100, _pos: x.pos * x.inn };
    }
    if (p.bowl) {
      const x = p.bowl;
      bowl = bowl ? {
        inn: bowl.inn + x.inn, b: bowl.b + x.b, r: bowl.r + x.r, w: bowl.w + x.w, md: bowl.md + x.md, w4: bowl.w4 + x.w4, w5: bowl.w5 + x.w5, w10: bowl.w10 + x.w10,
        f: bowl.f + x.f, s: bowl.s + x.s, wd: bowl.wd + x.wd, nb: bowl.nb + x.nb, _d: bowl._d + (x.dot * x.b) / 100,
        best: better(parseFig(bowl.best), parseFig(x.best), (a, b) => a.w > b.w || (a.w === b.w && a.r <= b.r))?.s,
        k: addMap(bowl.k, x.k), sp: addMap(bowl.sp, x.sp), vs: addMap(bowl.vs, x.vs), ph: null, last: [...bowl.last, ...x.last].sort((a, b) => a[0].localeCompare(b[0])).slice(-10),
      } : { ...x, _d: (x.dot * x.b) / 100 };
    }
  }
  if (bat) {
    const outs = bat.inn - bat.no;
    Object.assign(bat, { avg: outs ? r1(bat.r / outs) : null, sr: bat.b ? r1((100 * bat.r) / bat.b) : null, dot: bat.b ? Math.round((100 * bat._d) / bat.b) : null, bpb: bat.f + bat.s ? r1(bat.b / (bat.f + bat.s)) : null, pos: r1(bat._pos / bat.inn) });
  }
  if (bowl) Object.assign(bowl, { avg: bowl.w ? r1(bowl.r / bowl.w) : null, econ: bowl.b ? r1((6 * bowl.r) / bowl.b) : null, sr: bowl.w ? r1(bowl.b / bowl.w) : null, dot: bowl.b ? Math.round((100 * bowl._d) / bowl.b) : null });
  return { m: ps.reduce((s, p) => s + p.m, 0), from: ps.map((p) => p.from).sort()[0], to: ps.map((p) => p.to).sort().at(-1), bat, bowl, field: ps.reduce((a, p) => ({ ct: a.ct + p.field.ct, st: a.st + p.field.st, ro: a.ro + p.field.ro }), { ct: 0, st: 0, ro: 0 }) };
}

/* ---------- entry ---------- */
export async function renderPlayersTab(body, S, d, h) {
  const A = S.fx.a, B = S.fx.b;
  S.pp ||= { fmt: S.fmt };
  if (!S.PL) {
    body.innerHTML = `<div class="sk" style="height:220px"></div><div class="sk" style="height:260px"></div>`;
    const [pa, pb] = await Promise.all([loadPlayers(A), loadPlayers(B)]);
    // current players only: in this match's squads, or capped in the last 18 months (retired players drop out)
    const built = new Date((S.meta?.built || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
    const cutoff = new Date(Date.UTC(built.getUTCFullYear(), built.getUTCMonth() - 18, built.getUTCDate())).toISOString().slice(0, 10);
    const inSquad = new Set([...(d.squadA || []), ...(d.squadB || [])].map((p) => p.id));
    const current = (p) => inSquad.has(p.id) || (p.last || "") >= cutoff;
    S.PL = { [A]: pa.players.filter(current).map((p) => ({ ...p, t: A, sq: inSquad.has(p.id) })), [B]: pb.players.filter(current).map((p) => ({ ...p, t: B, sq: inSquad.has(p.id) })) };
    if (S.tab !== "matchups") return;
  }
  const all = [...S.PL[A], ...S.PL[B]];
  const find = (id) => all.find((p) => p.id === id);
  if (!all.length) { body.innerHTML = `<div class="empty">No player records for these teams.</div>`; return; }
  const L = find(S.pp.a) || null, R = find(S.pp.b) || null;
  body.innerHTML = view(S, d, h, L, R);
  wire(body, S, d, h);
}

function wire(body, S, d, h) {
  body.onclick = (e) => {
    const t = e.target.closest("[data-pf],[data-swap]");
    if (!t) return;
    if (t.dataset.swap != null) [S.pp.a, S.pp.b] = [S.pp.b, S.pp.a];
    if (t.dataset.pf) S.pp.fmt = t.dataset.pf;
    const scroller = body.closest(".d-scroll"), keep = scroller?.scrollTop;
    renderPlayersTab(body, S, d, h).then(() => {
      if (!scroller) return;
      scroller.scrollTop = keep;
    });
  };
  body.querySelectorAll("select[data-sel]").forEach((sel) => (sel.onchange = () => {
    S.pp[sel.dataset.sel] = sel.value;
    const scroller = body.closest(".d-scroll"), keep = scroller?.scrollTop;
    renderPlayersTab(body, S, d, h).then(() => { if (scroller) scroller.scrollTop = keep; body.querySelector(`select[data-sel="${sel.dataset.sel}"]`)?.focus(); });
  }));
}

/* ---------- view ---------- */
const sec = (title, { aside = "", take = "", body = "" } = {}) =>
  `<section class="sec"><div class="sec-h"><h3>${title}</h3>${aside ? `<span class="aside">${aside}</span>` : ""}</div>${take ? `<p class="take">${take}</p>` : ""}${body}</section>`;
const more = (label, body) => `<details class="more"><summary>${label}</summary><div class="more-body">${body}</div></details>`;

function view(S, d, h, L, R) {
  const e = h.esc, A = S.fx.a, B = S.fx.b, fmt = S.pp.fmt;
  const pickers = sec("Choose two players", { aside: `current players: this match's squads, plus anyone capped in the last 18 months`,
    body: `<div class="pv-pick">${picker(S, h, "a", "Player 1", L?.id)}<button class="swap" data-swap aria-label="Swap players" title="Swap"${L && R ? "" : " disabled"}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg></button>${picker(S, h, "b", "Player 2", R?.id)}</div>` });
  const note = `<p class="note">From Cricsheet ball-by-ball records of men's internationals${S.meta?.built ? ` up to ${h.dmy(S.meta.built)}` : ""}${S.meta?.since ? `: Tests from ${h.dmy(S.meta.since.Test)}, ODIs from ${h.dmy(S.meta.since.ODI)}, T20Is from ${h.dmy(S.meta.since.T20I)}` : ""}. Lists show current players only.</p>`;
  if (!L || !R) return pickers + `<div class="empty">${L || R ? "Now choose the second player." : "Choose two players to compare them, for example a batter from one side and a bowler from the other."}</div>` + note;
  const pick = (p) => (fmt === "All" ? combine(FMTS.map((f) => p.f[f])) : p.f[fmt] || null);
  const l = pick(L), r = pick(R);
  const side = (P) => (P.t === A ? "a" : "b");
  return `
  ${pickers}
  <div id="cmpTop"></div>
  ${sec("Comparison", { aside: fmt === "All" ? "all formats" : fmt,
    body: `<div class="seg sm" role="group" aria-label="Format" style="width:max-content">${["T20I", "ODI", "Test", "All"].map((f) => `<button data-pf="${f}" aria-pressed="${fmt === f}" ${f === "All" || L.f[f] || R.f[f] ? "" : 'disabled style="opacity:.35"'}>${f === "All" ? "All formats" : f}</button>`).join("")}</div>
    <div class="pcards">${pcard(L, l, side(L), h, fmt)}${pcard(R, r, side(R), h, fmt)}</div>
    ${!l && !r ? `<div class="empty">Neither player has played a ${fmt} in the data.</div>` : keyTable(S, h, L, R, l, r)}` })}
  ${faced(S, h, L, R)}
  ${l || r ? sec("More detail", { body: detailBlocks(S, h, L, R, l, r, fmt) }) : ""}
  ${note}`;
}

// A native dropdown: every player from both sides, grouped by team and role, most-capped first.
function picker(S, h, slot, label, selId) {
  const e = h.esc, A = S.fx.a, B = S.fx.b;
  const total = (p) => FMTS.reduce((n, f) => n + (p.f[f]?.m || 0), 0);
  const fmts = (p) => FMTS.filter((f) => p.f[f]).map((f) => `${f} ${p.f[f].m}`).join(", ");
  // per team: this match's squad first (by role), then other current players
  const byRole = (ps) => ROLE_ORDER.flatMap((ro) => ps.filter((p) => p.role === ro).sort((x, y) => total(y) - total(x)));
  const groups = [A, B].flatMap((t) => [[`${h.nm(t)} · Squad for this match`, byRole(S.PL[t].filter((p) => p.sq))], [`${h.nm(t)} · Other current players`, byRole(S.PL[t].filter((p) => !p.sq))]]).filter(([, ps]) => ps.length);
  const sel = [...S.PL[A], ...S.PL[B]].find((p) => p.id === selId);
  const RL = { BAT: "bat", WK: "wk", AR: "all-r", BOWL: "bowl" };
  return `<label class="pv-field" style="--tc:${h.col(sel?.t)}">
    <span class="pv-label">${label}</span>
    <select data-sel="${slot}" aria-label="${label}">
      <option value=""${selId ? "" : " selected"} disabled>Choose a player…</option>
      ${groups.map(([g, ps]) => `<optgroup label="${e(g)}">${ps.map((p) => `<option value="${e(p.id)}"${p.id === selId ? " selected" : ""}>${e(p.n)} (${RL[p.role] || ""})</option>`).join("")}</optgroup>`).join("")}
    </select>
    <span class="pv-sub">${sel ? `${e(h.nm(sel.t))} · ${{ BAT: "Batter", WK: "Wicketkeeper", AR: "All-rounder", BOWL: "Bowler" }[sel.role]} · ${fmts(sel)}` : ""}</span>
  </label>`;
}

function pcard(P, x, side, h, fmt) {
  const e = h.esc;
  const role = { BAT: "Batter", WK: "Wicketkeeper", AR: "All-rounder", BOWL: "Bowler" }[P.role];
  const bowler = P.role === "BOWL";
  const last = x ? (bowler ? x.bowl?.last : x.bat?.last)?.slice(-5) || [] : [];
  const max = fmt === "Test" ? 150 : fmt === "T20I" ? 75 : 100;
  const tc = (lvl) => (lvl === 2 ? `var(--${side})` : lvl === 1 ? `color-mix(in srgb, var(--${side}) 50%, transparent)` : "rgba(170,190,230,.2)");
  const bars = last.map((v) => (bowler
    ? { h: (v[4] / 5) * 100, lab: v[4], c: tc(v[4] >= 3 ? 2 : v[4] ? 1 : 0), t: `${v[4]}/${v[3]} v ${v[1]}` }
    : { h: (v[2] / max) * 100, lab: `${v[2]}${v[4] ? "" : "*"}`, c: tc(v[2] >= max * 0.55 ? 2 : v[2] >= max * 0.27 ? 1 : 0), t: `${v[2]}${v[4] ? "" : "*"} (${v[3]}b) v ${v[1]}` }));
  return `<div class="pcard" style="--tc:var(--${side})">
    <div class="pcard-name">${e(P.n)}</div>
    <div class="pcard-sub">${e(h.nm(P.t))} · ${role}${x ? ` · ${x.m} ${fmt === "All" ? "internationals" : fmt + "s"}` : ""}</div>
    <div class="last5"><span class="lbl">${bowler ? "WKT" : "RUNS"}</span>${bars.length ? bars.map((b) => `<i style="height:${Math.max(3, Math.min(100, b.h))}%;--c:${b.c}" title="${e(b.t)}"><b>${e(b.lab)}</b></i>`).join("") : `<span class="muted" style="font-size:11px">${x ? "No recent innings" : `No ${fmt}s`}</span>`}</div>
  </div>`;
}

/* ---------- key numbers: only what matters for these two roles ---------- */
function cmpRow(lab, a, b, { lower = false, none = false, num } = {}) {
  if ((a == null || a === "") && (b == null || b === "")) return "";
  const na = num ? num(a) : typeof a === "number" ? a : null, nb = num ? num(b) : typeof b === "number" ? b : null;
  let win = "";
  if (!none && na != null && nb != null && na !== nb) win = (na > nb) !== lower ? "a" : "b";
  return `<tr><td class="cv a${win === "a" ? " win" : ""}">${a ?? "—"}</td><th scope="row">${lab}</th><td class="cv b${win === "b" ? " win" : ""}">${b ?? "—"}</td></tr>`;
}
const fig = (s) => { const f = parseFig(s); return f ? f.w * 1000 - f.r : null; };
const bAvg = (a) => (a && a[3] ? r1(a[1] / a[3]) : null), bSR = (a) => (a && a[2] ? Math.round((100 * a[1]) / a[2]) : null);
const wEcon = (a) => (a && a[0] ? r1((6 * a[1]) / a[0]) : null);
const lead = (v) => (v == null ? null : parseInt(v, 10));

function keyTable(S, h, L, R, l, r) {
  const e = h.esc;
  const bats = [[L, l], [R, r]].some(([P, x]) => P.role !== "BOWL" && x?.bat?.inn);
  const bowls = [[L, l], [R, r]].some(([P, x]) => P.role !== "BAT" && P.role !== "WK" && x?.bowl?.w);
  const opp = (P) => (P.t === S.fx.a ? S.fx.b : S.fx.a);
  const rows = [cmpRow("Matches", l?.m, r?.m)];
  if (bats) rows.push(
    `<tr class="sub"><td></td><th>Batting</th><td></td></tr>`,
    cmpRow("Runs", l?.bat?.r, r?.bat?.r),
    cmpRow("Average", l?.bat?.avg, r?.bat?.avg),
    cmpRow("Strike rate", l?.bat?.sr, r?.bat?.sr),
    cmpRow("100s / 50s", l?.bat ? `${l.bat.c100} / ${l.bat.c50}` : null, r?.bat ? `${r.bat.c100} / ${r.bat.c50}` : null, { num: (v) => (v == null ? null : (([a, b]) => a * 1000 + b)(v.split(" / ").map(Number))) }),
    cmpRow("Last 12 months", l?.bat?.sp?.y1 ? `${l.bat.sp.y1[1]} runs` : null, r?.bat?.sp?.y1 ? `${r.bat.sp.y1[1]} runs` : null, { num: lead }),
    cmpRow(`Average v ${"opponent"}`, bAvg(l?.bat?.vs?.[opp(L)]), bAvg(r?.bat?.vs?.[opp(R)])),
  );
  if (bowls) rows.push(
    `<tr class="sub"><td></td><th>Bowling</th><td></td></tr>`,
    cmpRow("Wickets", l?.bowl?.w, r?.bowl?.w),
    cmpRow("Average", l?.bowl?.avg, r?.bowl?.avg, { lower: true }),
    cmpRow("Economy", l?.bowl?.econ, r?.bowl?.econ, { lower: true }),
    cmpRow("Best", l?.bowl?.best, r?.bowl?.best, { num: fig }),
    cmpRow("Last 12 months", l?.bowl?.sp?.y1 ? `${l.bowl.sp.y1[2]} wkts` : null, r?.bowl?.sp?.y1 ? `${r.bowl.sp.y1[2]} wkts` : null, { num: lead }),
  );
  return `<div class="card"><table class="cmp-t"><thead><tr><th class="cv a" style="color:${h.col(L.t)}">${e(L.n)}</th><th></th><th class="cv b" style="color:${h.col(R.t)}">${e(R.n)}</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    <p class="note">The better figure on each line is in bold. "Average v opponent" is each player's average against the other team.</p></div>`;
}

/* ---------- have they faced each other? ---------- */
function faced(S, h, L, R) {
  const e = h.esc, mus = S.P?.matchups || {};
  const line = (bat, bowl) => {
    const rows = FMTS.map((f) => { const m = (mus[f] || []).find((x) => x[0] === bat.id && x[1] === bowl.id); return m && { f, balls: m[2], runs: m[3], outs: m[4] }; }).filter(Boolean);
    if (!rows.length) return null;
    const t = rows.reduce((a, x) => ({ balls: a.balls + x.balls, runs: a.runs + x.runs, outs: a.outs + x.outs }), { balls: 0, runs: 0, outs: 0 });
    const by = rows.length > 1 ? `<div class="muted" style="font-size:12px;margin-top:2px">${rows.map((x) => `${x.f}: ${x.runs} off ${x.balls}, out ${x.outs}`).join(" · ")}</div>` : "";
    return `<li><b>${e(bat.n)}</b> has scored <b>${t.runs} off ${t.balls}</b> balls from <b>${e(bowl.n)}</b>, out <b>${t.outs}</b> time${t.outs === 1 ? "" : "s"} (SR ${Math.round((100 * t.runs) / t.balls)}${t.outs ? `, average ${r1(t.runs / t.outs)}` : ""}).${by}</li>`;
  };
  const items = [line(L, R), line(R, L)].filter(Boolean);
  return sec("Have they faced each other?", { aside: "all formats",
    body: items.length ? `<ul class="notes">${items.join("")}</ul>` : `<p class="take">${L.t === R.t ? `No. They play for the same side.` : `No. ${e(L.n)} and ${e(R.n)} haven't met as batter and bowler (at least 6 balls in a format).`}</p>` });
}

/* ---------- extra detail, folded away ---------- */
function detailBlocks(S, h, L, R, l, r, fmt) {
  const e = h.esc;
  const tbl = (rows) => `<table class="cmp-t"><thead><tr><th class="cv a" style="color:${h.col(L.t)}">${e(L.n)}</th><th></th><th class="cv b" style="color:${h.col(R.t)}">${e(R.n)}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const pctOf = (o, k, tot) => (o && tot ? `${Math.round((100 * (o[k] || 0)) / tot)}%` : null);
  const outs = (x) => (x?.bat ? x.bat.inn - x.bat.no : 0);
  const blocks = [];
  if (l?.bat || r?.bat) blocks.push(more("Batting in depth", tbl([
    cmpRow("Innings", l?.bat?.inn, r?.bat?.inn),
    cmpRow("Highest score", l?.bat?.hs, r?.bat?.hs, { num: (v) => parseHS(v)?.v ?? null }),
    cmpRow("Not outs", l?.bat?.no, r?.bat?.no, { none: true }),
    cmpRow("Ducks", l?.bat?.z, r?.bat?.z, { lower: true }),
    cmpRow("Fours / sixes", l?.bat ? `${l.bat.f} / ${l.bat.s}` : null, r?.bat ? `${r.bat.f} / ${r.bat.s}` : null, { none: true }),
    cmpRow("Balls per boundary", l?.bat?.bpb, r?.bat?.bpb, { lower: true }),
    cmpRow("Dot-ball %", l?.bat?.dot, r?.bat?.dot, { lower: true }),
    cmpRow("Usual position", l?.bat?.pos, r?.bat?.pos, { none: true }),
    cmpRow("Out caught", pctOf(l?.bat?.how, "caught", outs(l)), pctOf(r?.bat?.how, "caught", outs(r)), { none: true }),
    cmpRow("Out bowled / LBW", l?.bat && outs(l) ? `${pctOf(l.bat.how, "bowled", outs(l))} / ${pctOf(l.bat.how, "lbw", outs(l))}` : null, r?.bat && outs(r) ? `${pctOf(r.bat.how, "bowled", outs(r))} / ${pctOf(r.bat.how, "lbw", outs(r))}` : null, { none: true }),
  ])));
  if (l?.bowl?.w || r?.bowl?.w) blocks.push(more("Bowling in depth", tbl([
    cmpRow("Overs", l?.bowl ? Math.floor(l.bowl.b / 6) : null, r?.bowl ? Math.floor(r.bowl.b / 6) : null),
    cmpRow("Strike rate (balls per wicket)", l?.bowl?.sr, r?.bowl?.sr, { lower: true }),
    fmt === "Test" ? cmpRow("Best in a match", l?.bowl?.bbm, r?.bowl?.bbm, { num: fig }) : "",
    cmpRow("4 / 5-wicket hauls", l?.bowl ? `${l.bowl.w4} / ${l.bowl.w5}` : null, r?.bowl ? `${r.bowl.w4} / ${r.bowl.w5}` : null, { none: true }),
    cmpRow("Maidens", l?.bowl?.md, r?.bowl?.md),
    cmpRow("Dot-ball %", l?.bowl?.dot, r?.bowl?.dot),
    cmpRow("Wides / no-balls", l?.bowl ? `${l.bowl.wd} / ${l.bowl.nb}` : null, r?.bowl ? `${r.bowl.wd} / ${r.bowl.nb}` : null, { none: true }),
    cmpRow("Wickets bowled / LBW", l?.bowl?.w ? `${pctOf(l.bowl.k, "bowled", l.bowl.w)} / ${pctOf(l.bowl.k, "lbw", l.bowl.w)}` : null, r?.bowl?.w ? `${pctOf(r.bowl.k, "bowled", r.bowl.w)} / ${pctOf(r.bowl.k, "lbw", r.bowl.w)}` : null, { none: true }),
  ])));
  const batSplit = (x, k) => (x?.bat?.sp?.[k] ? `${bAvg(x.bat.sp[k]) ?? "—"} · ${bSR(x.bat.sp[k]) ?? "—"}` : null);
  const bowlSplit = (x, k) => (x?.bowl?.sp?.[k]?.[2] ? `${x.bowl.sp[k][2]} · ${wEcon(x.bowl.sp[k])}` : null);
  const where = [["home", "Home"], ["away", "Away"], ["neutral", "Neutral"]];
  if (l?.bat || r?.bat || l?.bowl?.w || r?.bowl?.w) blocks.push(more("Home, away and chasing", `
    ${l?.bat || r?.bat ? `<div class="grp">Batting · average · strike rate</div>${tbl([...where, ["bat1", "Batting first"], ["chase", "Chasing"]].map(([k, lab]) => cmpRow(lab, batSplit(l, k), batSplit(r, k), { none: true })))}` : ""}
    ${l?.bowl?.w || r?.bowl?.w ? `<div class="grp">Bowling · wickets · economy</div>${tbl([...where, ["chaseB", "Bowling first"], ["def", "Bowling second"]].map(([k, lab]) => cmpRow(lab, bowlSplit(l, k), bowlSplit(r, k), { none: true })))}` : ""}`));
  if (fmt === "T20I" || fmt === "ODI") {
    const PH = ["Powerplay", "Middle overs", "Death overs"];
    const any = (x) => x?.bat?.ph?.some(Boolean) || x?.bowl?.ph?.some(Boolean);
    if (any(l) || any(r)) blocks.push(more("By phase of the innings", tbl([
      ...PH.map((lab, i) => cmpRow(`${lab} · bat SR`, l?.bat?.ph?.[i]?.[0], r?.bat?.ph?.[i]?.[0])),
      ...PH.map((lab, i) => cmpRow(`${lab} · econ`, l?.bowl?.ph?.[i]?.[0], r?.bowl?.ph?.[i]?.[0], { lower: true })),
    ])));
  }
  const recent = (x, P) => {
    const bowler = P.role === "BOWL";
    const list = (bowler ? x?.bowl?.last : x?.bat?.last)?.slice().reverse() || [];
    if (!list.length) return `<div class="muted">No innings</div>`;
    return `<div class="inn-list">${list.map((v) => (bowler ? `<span title="v ${e(v[1])}, ${h.dmy(v[0])}"><b>${v[4]}/${v[3]}</b><small>v ${e(v[1])}</small></span>` : `<span title="${v[3]} balls v ${e(v[1])}, ${h.dmy(v[0])}"><b>${v[2]}${v[4] ? "" : "*"}</b><small>v ${e(v[1])}</small></span>`)).join("")}</div>`;
  };
  blocks.push(more("Last 10 innings", `<div class="grid2"><div><div class="grp" style="color:${h.col(L.t)}">${e(L.n)}</div>${recent(l, L)}</div><div><div class="grp" style="color:${h.col(R.t)}">${e(R.n)}</div>${recent(r, R)}</div></div>`));
  return blocks.join("");
}
