// Pure stats over the compact match records built by scripts/build-data.mjs.
// Match: {id,f,d,v,h,t:[x,y],w,res,by,toss:[code,dec],b1,s:[[team,runs,wkts,overs,dec]],wx:[tmax,rain,rh,cloud,dew,wind],sf}

export const FORMATS = ["T20I", "ODI", "Test"];

// Weather buckets; thresholds are deliberately simple so they can be explained in the UI.
export const CONDITIONS = [
  { k: "rain", label: "Rain during the match", sub: "≥ 5 mm in total", test: (w) => w[1] >= 5 },
  { k: "humid", label: "Humid", sub: "mean humidity ≥ 75%", test: (w) => w[2] >= 75 },
  { k: "over", label: "Overcast", sub: "mean cloud ≥ 60%", test: (w) => w[3] >= 60 },
  { k: "dew", label: "High dew point", sub: "≥ 18 °C, evening dew likely", test: (w) => w[4] >= 18, limited: true },
  { k: "hot", label: "Hot", sub: "max ≥ 33 °C", test: (w) => w[0] >= 33 },
  { k: "cool", label: "Cool", sub: "max ≤ 20 °C", test: (w) => w[0] <= 20 },
];
export const condTags = (m) => (m.wx ? CONDITIONS.filter((c) => (!c.limited || m.f !== "Test") && c.test(m.wx)).map((c) => c.k) : []);

export const SURFACES = { h: "High-scoring", m: "Par-scoring", l: "Low-scoring" };

const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
export { pct };

export function windowed(ms, win, built) {
  if (win !== "5y") return ms;
  const cut = new Date(built); cut.setFullYear(cut.getFullYear() - 5);
  const c = cut.toISOString().slice(0, 10);
  return ms.filter((m) => m.d >= c);
}

/* ---------- head-to-head ---------- */
function tally(ms, A, B) {
  const r = { p: ms.length, a: 0, b: 0, o: 0 };
  for (const m of ms) if (m.res === "W" && m.w === A) r.a++; else if (m.res === "W" && m.w === B) r.b++; else r.o++;
  return r;
}

export function h2hRows(ms, A, B, names) {
  const rows = [];
  const add = (group, label, sub, list) => rows.push({ group, label, sub, ...tally(list, A, B) });
  add("Overall", "All meetings", null, ms);
  add("Where", `In ${names[A]}`, `${names[A]} at home`, ms.filter((m) => m.h === A));
  add("Where", `In ${names[B]}`, `${names[B]} at home`, ms.filter((m) => m.h === B));
  add("Where", "Neutral venues", null, ms.filter((m) => m.h === "N"));
  add("Innings", `${names[A]} batted first`, null, ms.filter((m) => m.b1 === A));
  add("Innings", `${names[B]} batted first`, null, ms.filter((m) => m.b1 === B));
  add("Toss", `${names[A]} won the toss`, null, ms.filter((m) => m.toss?.[0] === A));
  add("Toss", `${names[B]} won the toss`, null, ms.filter((m) => m.toss?.[0] === B));
  for (const c of CONDITIONS) add("Conditions", c.label, c.sub, ms.filter((m) => condTags(m).includes(c.k)));
  for (const [k, l] of Object.entries(SURFACES)) add("Surface", l, null, ms.filter((m) => m.sf === k));
  return rows;
}

// Bat-first vs chase in a set of matches (any teams).
export function batFirstSplit(ms) {
  const dec = ms.filter((m) => m.res === "W" && m.b1);
  const bf = dec.filter((m) => m.w === m.b1).length;
  return { p: dec.length, bf, ch: dec.length - bf };
}
export function tossSplit(ms) {
  const t = ms.filter((m) => m.toss);
  const dec = t.filter((m) => m.res === "W");
  return { p: t.length, bat: t.filter((m) => m.toss[1] === "bat").length, won: dec.filter((m) => m.w === m.toss[0]).length, dec: dec.length };
}

/* ---------- a team against everyone ---------- */
export function teamRecord(ms, code) {
  const r = { p: ms.length, w: 0, l: 0, o: 0 };
  for (const m of ms) if (m.res === "W" && m.w === code) r.w++; else if (m.res === "W") r.l++; else r.o++;
  return r;
}
export function teamRows(ms, code) {
  const rows = [];
  const add = (group, label, sub, list) => rows.push({ group, label, sub, ...teamRecord(list, code) });
  add("Overall", "All matches", null, ms);
  add("Where", "Home", null, ms.filter((m) => m.h === code));
  add("Where", "Away", null, ms.filter((m) => m.h && m.h !== code && m.h !== "N"));
  add("Where", "Neutral", null, ms.filter((m) => m.h === "N"));
  add("Innings", "Batting first", null, ms.filter((m) => m.b1 === code));
  add("Innings", "Chasing", null, ms.filter((m) => m.b1 && m.b1 !== code));
  add("Toss", "Won the toss", null, ms.filter((m) => m.toss?.[0] === code));
  add("Toss", "Lost the toss", null, ms.filter((m) => m.toss && m.toss[0] !== code));
  for (const c of CONDITIONS) add("Conditions", c.label, c.sub, ms.filter((m) => condTags(m).includes(c.k)));
  for (const [k, l] of Object.entries(SURFACES)) add("Surface", l, null, ms.filter((m) => m.sf === k));
  return rows;
}
export const formString = (ms, code, n = 10) =>
  ms.slice(-n).map((m) => (m.res === "W" ? (m.w === code ? "W" : "L") : m.res));

/* ---------- win model ---------- */
// Three transparent factors, each a smoothed win rate turned into an A-vs-B probability, blended in logit space.
const smooth = (w, n, k = 2) => (w + k) / (n + 2 * k);
const log5 = (a, b) => (a * (1 - b)) / (a * (1 - b) + b * (1 - a));
const logit = (p) => Math.log(p / (1 - p));
const inv = (x) => 1 / (1 + Math.exp(-x));

export function winModel({ A, B, fmt, home, pairMs, teamA, teamB, built }) {
  const factors = [];
  // 1. head-to-head, last 5 years (falls back to all-time if fewer than 4 decisive games)
  let h = windowed(pairMs, "5y", built).filter((m) => m.f === fmt && m.res === "W");
  let hNote = "last 5 years";
  if (h.length < 4) { h = pairMs.filter((m) => m.f === fmt && m.res === "W"); hNote = "all time"; }
  if (h.length) {
    const aw = h.filter((m) => m.w === A).length;
    factors.push({ k: "Head-to-head", sub: `${aw}–${h.length - aw} ${hNote}`, p: smooth(aw, h.length), w: 0.35 });
  }
  // 2. each side's record in this venue type (home / away / neutral), last 5 years
  const vt = (code) => (home === "N" || !home ? "N" : home === code ? "home" : "away");
  const recIn = (ms, code) => {
    const t = vt(code);
    const list = windowed(ms, "5y", built).filter((m) => m.res === "W" && (t === "N" ? m.h === "N" : t === "home" ? m.h === code : m.h && m.h !== code && m.h !== "N"));
    const w = list.filter((m) => m.w === code).length;
    return { w, n: list.length, t };
  };
  if (teamA && teamB) {
    const ra = recIn(teamA, A), rb = recIn(teamB, B);
    if (ra.n + rb.n >= 4) {
      const lab = (r, c) => `${c} ${r.w}–${r.n - r.w} ${r.t === "N" ? "neutral" : r.t}`;
      factors.push({ k: "Venue record", sub: `${lab(ra, A)} · ${lab(rb, B)}`, p: log5(smooth(ra.w, ra.n), smooth(rb.w, rb.n)), w: 0.35 });
    }
    // 3. recent form, last 10 decisive games
    const f10 = (ms, code) => { const d = ms.filter((m) => m.res === "W").slice(-10); return { w: d.filter((m) => m.w === code).length, n: d.length }; };
    const fa = f10(teamA, A), fb = f10(teamB, B);
    if (fa.n && fb.n) factors.push({ k: "Recent form", sub: `${A} ${fa.w}/${fa.n} · ${B} ${fb.w}/${fb.n} won`, p: log5(smooth(fa.w, fa.n), smooth(fb.w, fb.n)), w: 0.3 });
  }
  if (!factors.length) return null;
  const tw = factors.reduce((s, f) => s + f.w, 0);
  const p = inv(factors.reduce((s, f) => s + (f.w / tw) * logit(Math.min(0.97, Math.max(0.03, f.p))), 0));
  return { p, factors };
}

/* ---------- players ---------- */
export const ROLE_LABEL = { BAT: "BAT", BOWL: "BOWL", AR: "AR", WK: "WK" };

/* ---------- predicted XI: a scored rubric, then team-balance rules ----------
   Each squad player scores 0–100:
     Selection continuity  30  games played of the side's last 5 (25) + played the most recent game (5)
     Current form          30  last 5 innings/spells against a format benchmark (batting: runs per innings + strike rate;
                               bowling: wickets per spell + economy). All-rounders use the better skill, blended with the other.
     Proven record         20  career figures in this format, shrunk toward average when there are fewer than 15 matches
     Record v opponent     10  batting average or wickets per match against this opponent (5 = neutral when no history)
     Freshness             10  days since they last played compared with the side's latest game (falls to 0 by 120 days:
                               a long gap usually means injury, rest or being dropped)
   Balance rules then build the XI from the highest scores:
     exactly one designated keeper (the best-scoring WK; a second WK can only play as a batter),
     at least 5 bowling options (bowlers + all-rounders), 3–5 specialist bowlers (4–5 in Tests),
     at least 6 batting options (batters, keepers, all-rounders) and at most 7 specialist batters/keepers;
     and, when the announced squad gives bowling styles, at least one spinner and two pacers. */
export const RUBRIC = [
  ["Selection continuity", 30, "Games played of the last 5, plus the most recent game"],
  ["Current form", 30, "Last 5 innings or spells against a format benchmark"],
  ["Proven record", 20, "Career figures in this format (small samples count less)"],
  ["Record v opponent", 10, "Batting average or wickets per match against this team"],
  ["Freshness", 10, "Days since last played; long gaps suggest injury or being dropped"],
];
const BENCH = {
  T20I: { rpi: 25, sr: 135, avg: 25, wps: 1.2, econ: 8, bavg: 24 },
  ODI: { rpi: 35, sr: 85, avg: 35, wps: 1.5, econ: 5.2, bavg: 32 },
  Test: { rpi: 40, sr: 55, avg: 38, wps: 2, econ: 3.2, bavg: 32 },
};
const c01 = (x) => Math.max(0, Math.min(1, x));
const bowls = (p) => p.role === "BOWL" || p.role === "AR";

export function selectionScore(p, fmt, { opp, teamLast } = {}) {
  const B = BENCH[fmt] || BENCH.T20I;
  // 1. continuity
  const cont = (p.apps[1] ? p.apps[0] / Math.max(5, p.apps[1]) : 0) * 25 + (teamLast && p.lastPlayed === teamLast ? 5 : 0);
  // 2. form
  const bat = (() => {
    const x = p.bat5; if (!x.length) return 0;
    const r = x.reduce((s, i) => s + i[2], 0), b = x.reduce((s, i) => s + i[3], 0);
    return c01((0.6 * (r / x.length) / B.rpi + 0.4 * (b ? (100 * r) / b / B.sr : 0)) / 1.5);
  })();
  const bowl = (() => {
    const x = p.bowl5; if (!x.length) return 0;
    const w = x.reduce((s, i) => s + i[4], 0), r = x.reduce((s, i) => s + i[3], 0), balls = x.reduce((s, i) => { const [o, bb = "0"] = String(i[2]).split("."); return s + +o * 6 + +bb; }, 0);
    const econ = balls ? (6 * r) / balls : B.econ * 1.5;
    return c01((0.6 * (w / x.length) / B.wps + 0.4 * (B.econ / Math.max(1, econ))) / 1.5);
  })();
  const form = (p.role === "BOWL" ? bowl : p.role === "AR" ? 0.65 * Math.max(bat, bowl) + 0.35 * Math.min(bat, bowl) : bat) * 30;
  // 3. proven record (shrunk toward 0.5 for small samples)
  const c = p.career, k = c01((c.m || 0) / 15);
  const recBat = c.inn ? c01(0.6 * ((c.avg ?? c.r / Math.max(1, c.inn)) / B.avg) / 1.5 + 0.4 * ((c.sr || 0) / B.sr) / 1.5) : 0;
  const recBowl = c.w ? c01(0.6 * (B.bavg / Math.max(8, c.bavg || 99)) / 1.5 + 0.4 * (B.econ / Math.max(1, c.econ || 99)) / 1.5 + Math.min(0.2, c.w / 200)) : 0;
  const rec0 = p.role === "BOWL" ? recBowl : p.role === "AR" ? Math.max(recBat, recBowl) : recBat;
  const record = (k * rec0 + (1 - k) * 0.5) * 20;
  // 4. v opponent: [m, inns, runs, balls, outs, bowl balls, bowl runs, wkts]
  const v = opp && p.vs?.[opp];
  let vsOpp = 5;
  if (v && v[0] >= 2) {
    const ba = v[4] ? v[2] / v[4] : v[2], wpm = v[7] / v[0];
    const sBat = c01(ba / (B.avg * 1.5)), sBowl = c01(wpm / (B.wps * 1.5));
    vsOpp = (p.role === "BOWL" ? sBowl : p.role === "AR" ? Math.max(sBat, sBowl) : sBat) * 10;
  }
  // 5. freshness
  const gap = teamLast && p.lastPlayed ? (Date.parse(teamLast) - Date.parse(p.lastPlayed)) / 864e5 : 120;
  const fresh = c01(1 - gap / 120) * 10;
  const parts = [cont, form, record, vsOpp, fresh];
  return { total: Math.round(parts.reduce((a, b) => a + b, 0)), parts: parts.map((x) => Math.round(x * 10) / 10), formBat: bat, formBowl: bowl };
}

export function predictXI(squad, fmt, ctx = {}) {
  if (!squad?.length) return [];
  const scored = squad.filter((p) => p.lastPlayed).map((p) => ({ p, s: selectionScore(p, fmt, ctx) })).sort((a, b) => b.s.total - a.s.total);
  const test = fmt === "Test";
  const lim = { BOWL: [test ? 4 : 3, 5], AR: [0, test ? 2 : 3], specialistBat: [3, 7] };
  const xi = [];
  const count = (f) => xi.filter((x) => f(x)).length;
  const keeper = scored.find((x) => x.p.role === "WK");
  if (keeper) xi.push({ ...keeper, keeps: true });
  for (const x of scored) {
    if (xi.length === 11) break;
    if (xi.includes(x) || (keeper && x.p === keeper.p)) continue;
    const r = x.p.role;
    if (r === "BOWL" && count((y) => y.p.role === "BOWL") >= lim.BOWL[1]) continue;
    if (r === "AR" && count((y) => y.p.role === "AR") >= lim.AR[1]) continue;
    if ((r === "BAT" || r === "WK") && count((y) => y.p.role === "BAT" || y.p.role === "WK") >= lim.specialistBat[1]) continue;
    // keep room for the bowlers we still need
    const needBowl = Math.max(0, 5 - count((y) => bowls(y.p))), needSpec = Math.max(0, lim.BOWL[0] - count((y) => y.p.role === "BOWL"));
    if (!bowls(x.p) && 11 - xi.length <= Math.max(needBowl, needSpec)) continue;
    if (r === "AR" && 11 - xi.length <= needSpec) continue;
    xi.push(x);
  }
  // top up if the squad was short of a type
  for (const x of scored) { if (xi.length >= 11) break; if (!xi.some((y) => y.p === x.p)) xi.push(x); }
  // with bowling styles from the announced squad: at least one spinner and two pacers among the bowling options
  const needType = (type, n) => {
    const have = () => xi.filter((y) => bowls(y.p) && y.p.type === type).length;
    while (have() < n) {
      const add = scored.find((x) => bowls(x.p) && x.p.type === type && !xi.some((y) => y.p === x.p));
      const other = type === "spin" ? "pace" : "spin";
      const drop = [...xi].reverse().find((y) => y.p.role === "BOWL" && y.p.type === other && xi.filter((z) => bowls(z.p) && z.p.type === other).length > (other === "pace" ? 2 : 1));
      if (!add || !drop) break;
      xi.splice(xi.indexOf(drop), 1, add);
    }
  };
  if (xi.some((y) => y.p.type)) { needType("spin", 1); needType("pace", 2); }
  return xi
    .sort((a, b) => (a.p.career.pos ?? 12) - (b.p.career.pos ?? 12))
    .map((x) => ({ p: x.p, score: x.s.total, parts: x.s.parts, keeps: !!x.keeps, reason: reasonFor(x, fmt, ctx) }));
}

function reasonFor(x, fmt, ctx) {
  const p = x.p, [cont, form, record, vs] = x.s.parts;
  const bits = [];
  const role = { WK: x.keeps ? "Keeper" : "Batter (also keeps)", BAT: "Batter", BOWL: "Bowler", AR: "All-rounder" }[p.role];
  bits.push(`${role}${p.type ? ` (${p.type})` : ""}, selection score ${x.s.total}/100`);
  if (cont >= 25) bits.push(`ever-present (${p.apps[0]} of last ${p.apps[1]})`);
  else if (cont >= 15) bits.push(`played ${p.apps[0]} of last ${p.apps[1]}`);
  if (form >= 18) bits.push(`in form: ${formLine(p)}`);
  else if (form < 8 && (p.bat5.length || p.bowl5.length)) bits.push(`quiet lately (${formLine(p)})`);
  if (record >= 15) bits.push(`strong ${fmt} record`);
  if (vs >= 8 && ctx.opp) bits.push(`good record v ${ctx.opp}`);
  return bits.join("; ") + ".";
}

export function formLine(p) {
  const bits = [];
  if (p.bat5.length && p.role !== "BOWL") {
    const r = p.bat5.reduce((s, x) => s + x[2], 0), b = p.bat5.reduce((s, x) => s + x[3], 0), o = p.bat5.reduce((s, x) => s + x[4], 0);
    bits.push(`${r} runs in last ${p.bat5.length} inns${o ? ` (avg ${(r / o).toFixed(1)})` : ""}${b ? `, SR ${Math.round((100 * r) / b)}` : ""}`);
  }
  if (p.bowl5.length && (p.role !== "BAT")) {
    const w = p.bowl5.reduce((s, x) => s + x[4], 0);
    const balls = p.bowl5.reduce((s, x) => s + oversToBalls(x[2]), 0), r = p.bowl5.reduce((s, x) => s + x[3], 0);
    bits.push(`${w} wkts in last ${p.bowl5.length} spells${balls ? `, econ ${((r / balls) * 6).toFixed(1)}` : ""}`);
  }
  return bits.join("; ") || "No recent innings in the data";
}
export const oversToBalls = (o) => { const [a, b = "0"] = String(o).split("."); return +a * 6 + +b; };


/* ---------- matchups ---------- */
const NORM = { T20I: { sr: 140, avg: 22 }, ODI: { sr: 92, avg: 32 }, Test: { sr: 58, avg: 36 } };
export function matchupEdge(fmt, balls, runs, outs) {
  const n = NORM[fmt], sr = balls ? (100 * runs) / balls : 0, avg = outs ? runs / outs : Infinity;
  if (outs >= 2 && avg < n.avg * 0.7) return "bowl";
  if (outs >= 1 && balls / outs < (fmt === "T20I" ? 12 : 30)) return "bowl";
  if (sr >= n.sr * 1.12 && avg >= n.avg) return "bat";
  if (outs === 0 && balls >= 18 && sr >= n.sr) return "bat";
  return "even";
}

/* ---------- venue trends (top 3 most relevant, computed) ---------- */
export function venueTrends(V, fmt, built) {
  const F = V?.fmt?.[fmt];
  if (!F || F.p < 2) return [];
  const out = [];
  const add = (score, text) => out.push({ score, text });
  if (F.res >= 3) {
    const b = pct(F.b1w, F.res);
    const lean = b >= 58 ? "Batting first has the edge" : b <= 42 ? "Chasing is the way to win here" : "No strong edge between batting first and chasing";
    add(Math.abs(b - 50) + 10, `${lean}: sides batting first won ${F.b1w} of ${F.res} ${fmt}s (${b}%).`);
  }
  if (F.avg1) add(30, `Average first-innings score is ${F.avg1}${F.avg2 ? `, ${F.avg2} batting second` : ""} across ${F.p} ${fmt}s since ${F.first?.slice(0, 4) || "records began"}.`);
  if (F.toss >= 4) {
    const bp = pct(F.tossBat, F.toss), tw = pct(F.tossWon, F.tossDec ?? F.toss);
    add(Math.abs(bp - 50) / 2 + Math.abs(tw - 50), `Toss winners chose to ${bp >= 50 ? "bat" : "field"} ${Math.max(bp, 100 - bp)}% of the time and went on to win ${tw}% of matches.`);
  }
  if (F.ph && fmt !== "Test" && F.ph[0] && F.ph[2]) {
    add(18, `Scoring rate climbs from ${F.ph[0][0]} an over in the powerplay to ${F.ph[2][0]} at the death; ${F.ph[1][1]} wickets fall per 10 overs in the middle phase.`);
  }
  if (F.wx) {
    const [t, rh, cl, dew, rain] = F.wx;
    if (dew >= 18 && fmt !== "Test") add(26, `Typical match-day dew point is ${dew} °C, so evening dew is a regular factor for the side bowling second.`);
    else if (rh >= 75) add(20, `Match days here average ${rh}% humidity and ${t} °C.`);
    if (cl >= 55) add(18, `Often overcast: average cloud cover ${cl}% on match days, which helps swing.`);
    if (rain >= 4) add(16, `Rain is common: ${rain} mm per match on average.`);
  }
  if (F.hi) add(8, `Highest total: ${F.hi[0]}/${F.hi[1]} by ${F.hi[2]} (${F.hi[3].slice(0, 4)}).`);
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.text);
}

/* ---------- announced squads (CricketData) merged with our player records ---------- */
const norm = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// "Vaibhav Sooryavanshi" (API) = "Vaibhav Suryavanshi" (ours); "Mohammed Siraj" = "Mohammed Siraj"
export function sameName(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(" "), ys = y.split(" ");
  const xl = xs.at(-1), yl = ys.at(-1);
  if (xs[0] === ys[0] && lev(xl, yl) <= 2 && Math.min(xl.length, yl.length) >= 5) return true;
  return xl === yl && xs[0][0] === ys[0][0] && (xs[0].length <= 2 || ys[0].length <= 2); // initials v full first name
}
// Returns the squad limited to announced players (when enough of them match), each tagged with pace/spin,
// plus the announced players we have no recent record for.
export function applyAnnounced(squad, team) {
  if (!team?.players?.length) return { squad, extra: [], announced: false };
  const used = new Set();
  const tagged = squad.map((p) => {
    const a = team.players.find((x, i) => !used.has(i) && sameName(x.name, p.n));
    if (!a) return { ...p, announced: false };
    used.add(team.players.indexOf(a));
    // our records sometimes still use initials ("MW Forde"); the announced squad has the full name
    // the announced role ("Batting Allrounder", "WK-Batsman") beats our inference from the numbers
    const r = String(a.role || "").toLowerCase();
    const role = /wk|keeper/.test(r) ? "WK" : /allrounder|all-rounder/.test(r) ? "AR" : /bowler/.test(r) ? "BOWL" : /bats|batter/.test(r) ? "BAT" : p.role;
    return { ...p, role, n: /^[A-Z]{1,4} /.test(p.n) ? a.name : p.n, announced: true, type: a.type, bowlStyle: a.bowl, apiRole: a.role };
  });
  const inSquad = tagged.filter((p) => p.announced);
  const extra = team.players.filter((_, i) => !used.has(i));
  return inSquad.length >= 11 ? { squad: inSquad, extra, announced: true } : { squad: tagged, extra, announced: inSquad.length > 0 };
}

/* ---------- recent matches (Cricbuzz) the Cricsheet archive doesn't have yet ---------- */
// Adds each new match to the side's match list (form, win model, head-to-head) and each squad player's
// last five innings and spells. Idempotent: a match is merged once per team file.
export function compactRecent(m) {
  return { id: "cb-" + m.cbMatch, f: m.fmt, d: m.d, v: null, h: m.host || null, t: [m.a, m.b], w: m.w, res: m.res, by: m.by, toss: null,
    b1: m.innings[0]?.team || null, s: m.innings.map((i) => [i.team, i.r, i.w, i.ov, i.dec ? 1 : 0]), wx: null, sf: null, src: "cricbuzz" };
}
export function mergeRecent(team, code, fmt, recent) {
  const F = team?.formats?.[fmt];
  if (!F || !recent?.length) return [];
  F._merged ||= new Set();
  const added = [];
  for (const m of recent) {
    if (m.fmt !== fmt || ![m.a, m.b].includes(code) || F._merged.has(m.cbMatch) || F.matches.some((x) => x.d === m.d && x.t.includes(m.a) && x.t.includes(m.b))) continue;
    F._merged.add(m.cbMatch); added.push(m);
    const opp = m.a === code ? m.b : m.a;
    F.matches.push(compactRecent(m));
    const mine = m.innings.filter((i) => i.team === code), theirs = m.innings.filter((i) => i.team === opp);
    const xi = mine.flatMap((i) => i.xi || []).concat(theirs.flatMap((i) => i.bowl.map((b) => b.name)));
    for (const p of F.squad) {
      const bats = mine.flatMap((i) => i.bat.filter((b) => sameName(b.name, p.n)));
      const bowls = theirs.flatMap((i) => i.bowl.filter((b) => sameName(b.name, p.n)));
      const played = bats.length || bowls.length || xi.some((n) => sameName(n, p.n));
      for (const b of bats) p.bat5 = [...p.bat5, [m.d, opp, b.r, b.b, b.out ? 1 : 0, b.pos, "cb-" + m.cbMatch]].slice(-5);
      for (const b of bowls) p.bowl5 = [...p.bowl5, [m.d, opp, b.ov, b.r, b.w, "cb-" + m.cbMatch]].slice(-5);
      // appearances in the last five: the oldest of the five drops out, this one comes in
      if (p.a5 != null) { p.a5 = (p.a5 + (played ? "1" : "0")).slice(-5); p.apps = [[...p.a5].filter((x) => x === "1").length, p.a5.length]; }
      else p.apps = [Math.min(5, Math.round(p.apps[0] * 0.8) + (played ? 1 : 0)), 5]; // older data files without the sequence
      if (played) p.lastPlayed = m.d;
    }
  }
  F.matches.sort((x, y) => x.d.localeCompare(y.d));
  return added;
}
