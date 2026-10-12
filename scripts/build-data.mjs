// Builds compact JSON for the app from Cricsheet ball-by-ball data + Open-Meteo weather.
// Usage: node scripts/build-data.mjs   (expects unzipped Cricsheet archives in .cache/raw)
// Output: public/data/{meta,venues}.json, public/data/teams/<CODE>.json, public/data/pairs/<A>-<B>.json
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, ".cache/raw");
const CACHE = path.join(ROOT, ".cache");
const OUT = path.join(ROOT, "public/data");
const ARCHIVES = ["tests_male_json", "odis_male_json", "t20s_male_json"];
const FMT = { Test: "Test", ODI: "ODI", T20: "T20I" };

// cc = ISO country codes that count as "home" for the team
export const TEAMS = {
  IND: { name: "India", cc: ["IN"] },
  AUS: { name: "Australia", cc: ["AU"] },
  ENG: { name: "England", cc: ["GB"] },
  NZ: { name: "New Zealand", cc: ["NZ"] },
  SA: { name: "South Africa", cc: ["ZA"] },
  PAK: { name: "Pakistan", cc: ["PK"] },
  SL: { name: "Sri Lanka", cc: ["LK"] },
  BAN: { name: "Bangladesh", cc: ["BD"] },
  WI: { name: "West Indies", cc: ["JM", "TT", "BB", "GY", "AG", "LC", "VC", "GD", "DM", "KN"] },
  ZIM: { name: "Zimbabwe", cc: ["ZW"] },
  IRE: { name: "Ireland", cc: ["IE"] },
  AFG: { name: "Afghanistan", cc: ["AF"] },
  UAE: { name: "United Arab Emirates", cc: ["AE"] },
};
const BY_NAME = Object.fromEntries(Object.entries(TEAMS).map(([k, v]) => [v.name, k]));
const MAJORS = new Set(Object.keys(TEAMS));
// Short codes for associate nations; anything not listed gets one generated from its name.
const ASSOC = {
  Scotland: "SCO", Netherlands: "NED", Nepal: "NEP", Namibia: "NAM", Oman: "OMA", "United States of America": "USA", Canada: "CAN",
  "Papua New Guinea": "PNG", "Hong Kong": "HK", Kenya: "KEN", Uganda: "UGA", Jersey: "JER", Guernsey: "GUE", Bermuda: "BER",
  Singapore: "SIN", Malaysia: "MAS", Qatar: "QAT", Kuwait: "KUW", Bahrain: "BHR", "Saudi Arabia": "KSA", Italy: "ITA", Germany: "GER",
  Denmark: "DEN", Austria: "AUT", Spain: "ESP", France: "FRA", Belgium: "BEL", Portugal: "POR", Romania: "ROU", "Czech Republic": "CZE",
  Tanzania: "TAN", Rwanda: "RWA", Nigeria: "NGR", Ghana: "GHA", Botswana: "BOT", Malawi: "MWI", Mozambique: "MOZ", "Sierra Leone": "SLE",
  Vanuatu: "VAN", Samoa: "SAM", Fiji: "FIJ", Japan: "JPN", "South Korea": "KOR", China: "CHN", Thailand: "THA", Philippines: "PHI",
  Indonesia: "INA", Bhutan: "BHU", Maldives: "MDV", Myanmar: "MYA", Mongolia: "MGL", Argentina: "ARG", Brazil: "BRA", Mexico: "MEX",
  "Cayman Islands": "CAY", Bahamas: "BAH", Belize: "BLZ", Panama: "PAN", Peru: "PER", Chile: "CHI", "Isle of Man": "IOM", Gibraltar: "GIB",
  Finland: "FIN", Sweden: "SWE", Norway: "NOR", Estonia: "EST", Hungary: "HUN", Bulgaria: "BUL", Serbia: "SRB", Croatia: "CRO", Greece: "GRE",
  Cyprus: "CYP", Malta: "MLT", Luxembourg: "LUX", Switzerland: "SUI", Turkey: "TUR", Israel: "ISR", Slovenia: "SLO", Iran: "IRN",
  "Cook Islands": "COK", Eswatini: "SWZ", Lesotho: "LES", Cameroon: "CMR", Gambia: "GAM", "St Helena": "SHN", Seychelles: "SEY",
};
const nameToCC = new Map(); // "Papua New Guinea" -> "PG", built from Intl
{
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const cc = String.fromCharCode(a, b);
    try { const n = dn.of(cc); if (n && n !== cc) nameToCC.set(n, cc); } catch {}
  }
  for (const [n, cc] of Object.entries({ "United States of America": "US", "Hong Kong": "HK", "Czech Republic": "CZ", "South Korea": "KR", Turkey: "TR", "St Helena": "SH", Eswatini: "SZ", Gambia: "GM", "Isle of Man": "IM" })) nameToCC.set(n, cc);
}
function register(name) {
  if (BY_NAME[name]) return BY_NAME[name];
  let c = ASSOC[name] || name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  while (TEAMS[c] && TEAMS[c].name !== name) c = c.slice(0, 3) + (Number(c.slice(3) || 1) + 1);
  TEAMS[c] = { name, cc: name === "Scotland" ? ["GB"] : nameToCC.get(name) ? [nameToCC.get(name)] : [] };
  BY_NAME[name] = c;
  return c;
}

// Cricsheet sometimes omits the city; these venues are the common cases.
const VENUE_CITY = {
  "Harare Sports Club": "Harare", "Dubai International Cricket Stadium": "Dubai", "Dubai Sports City Cricket Stadium": "Dubai",
  "Melbourne Cricket Ground": "Melbourne", "Sydney Cricket Ground": "Sydney", "Pallekele International Cricket Stadium": "Kandy",
  "Adelaide Oval": "Adelaide", "Rangiri Dambulla International Stadium": "Dambulla", "Galle International Stadium": "Galle",
  "Sharjah Cricket Stadium": "Sharjah", "Rawalpindi Cricket Stadium": "Rawalpindi", "Multan Cricket Stadium": "Multan",
  "Sylhet Stadium": "Sylhet", "Sylhet International Cricket Stadium": "Sylhet", "Chittagong Divisional Stadium": "Chittagong",
  "Queenstown Events Centre": "Queenstown", "Mombasa Sports Club Ground": "Mombasa", "Perth Stadium": "Perth",
  "Bulawayo Athletic Club": "Bulawayo", "Sheikhupura Stadium": "Sheikhupura", "Carrara Oval": "Gold Coast",
};
// Cities whose most-populous namesake is in the wrong country.
const CITY_CC = {
  Providence: "GY", Hamilton: "NZ", Mirpur: "BD", Bristol: "GB", Kingston: "JM", "St George's": "GD", Victoria: "SC",
  Canterbury: "GB", Durham: "GB", "Chester-le-Street": "GB", Taunton: "GB", Hove: "GB", Queenstown: "NZ", Nelson: "NZ",
  Lincoln: "NZ", "East London": "ZA", Kimberley: "ZA", Paarl: "ZA", Basseterre: "KN", "Gros Islet": "LC", Roseau: "DM",
  Kingstown: "VC", "North Sound": "AG", Bridgetown: "BB", "Port of Spain": "TT", Tarouba: "TT", Georgetown: "GY",
  Hyderabad: "IN", Lauderhill: "US", "King City": "CA", Dharmasala: "IN", Dharamsala: "IN", Mohali: "IN", Chandigarh: "IN",
};
// Names the geocoder gets wrong outright (Cricsheet uses island names or old city names): [cc, lat, lon]
const CITY_FIX = {
  Bangalore: ["IN", 12.979, 77.599], "St Kitts": ["KN", 17.302, -62.717], "St Vincent": ["VC", 13.144, -61.21],
  Dominica: ["DM", 15.302, -61.388], "St George's": ["GD", 12.077, -61.748],
  Sind: ["PK", 25.396, 68.358], Providence: ["GY", 6.76, -58.17], "St Lucia": ["LC", 14.079, -60.949],
};
// Canonical city spellings and renamed grounds, so one ground = one venue.
const CITY_ALIAS = { Carrara: "Gold Coast", Bangalore: "Bengaluru", Bombay: "Mumbai", Madras: "Chennai", Calcutta: "Kolkata", Chittagong: "Chattogram", "Port Elizabeth": "Gqeberha", Mohali: "Chandigarh", Dharmasala: "Dharamsala" };
const VENUE_ALIAS = {
  "Sardar Patel Stadium": "Narendra Modi Stadium", "Sardar Patel (Gujarat) Stadium": "Narendra Modi Stadium", "Feroz Shah Kotla": "Arun Jaitley Stadium",
  "Punjab Cricket Association IS Bindra Stadium": "Punjab Cricket Association Stadium", "Zohur Ahmed Chowdhury Stadium": "Zahur Ahmed Chowdhury Stadium",
  "Sheikh Zayed Stadium": "Zayed Cricket Stadium", "Bay Oval": "Bay Oval", "Brian Lara Stadium": "Brian Lara Cricket Academy",
};
const BOWLER_WKT = new Set(["bowled", "caught", "lbw", "stumped", "caught and bowled", "hit wicket"]);

const daysAgo = (iso, ref) => (new Date(ref) - new Date(iso)) / 864e5;
const r1 = (x) => Math.round(x * 10) / 10;
const ovs = (balls, bpo = 6) => `${Math.floor(balls / bpo)}${balls % bpo ? "." + (balls % bpo) : ""}`;
const readFile = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------- 1. parse matches ---------------- */
function phaseOf(fmt, over) {
  if (fmt === "T20I") return over < 6 ? 0 : over < 15 ? 1 : 2;
  if (fmt === "ODI") return over < 10 ? 0 : over < 40 ? 1 : 2;
  return -1;
}

const matches = [];
const people = {}; // id -> name
const bvb = { Test: new Map(), ODI: new Map(), T20I: new Map() }; // "bat|bowl" -> [balls, runs, outs, dots, 4s, 6s]

for (const dir of ARCHIVES) {
  for (const f of fs.readdirSync(path.join(RAW, dir))) {
    if (!f.endsWith(".json")) continue;
    const { info, innings = [] } = JSON.parse(fs.readFileSync(path.join(RAW, dir, f), "utf8"));
    if (info.gender !== "male" || info.team_type !== "international") continue;
    const fmt = FMT[info.match_type];
    if (!fmt) continue;
    const code = (t) => register(t);
    const reg = info.registry?.people || {};
    const pid = (n) => { const id = reg[n] || "n:" + n; people[id] = n; return id; };
    const bpo = info.balls_per_over || 6;

    // pid -> { team, bats:[per innings {r,b,d,f,s,out,how,pos}], bowls:[per innings {b,r,w,d,f,s,wd,nb,md,k}], ct, st, ro, ph }
    const lines = {};
    const L = (id, team) => (lines[id] ||= { team, bats: {}, bowls: {}, ct: 0, st: 0, ro: 0, ph: { bat: [[0, 0], [0, 0], [0, 0]], bowl: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] } });
    for (const [t, ps] of Object.entries(info.players || {})) for (const n of ps) L(pid(n), code(t));
    const NEWBAT = (pos) => ({ r: 0, b: 0, d: 0, f: 0, s: 0, out: false, how: "not out", pos });
    const NEWBOWL = () => ({ b: 0, r: 0, w: 0, d: 0, f: 0, s: 0, wd: 0, nb: 0, md: 0, k: {} });

    const inns = [];
    for (const inn of innings) {
      if (inn.super_over) continue;
      const ii = inns.length;
      const bt = code(inn.team);
      const fieldTeam = code(info.teams.find((t) => t !== inn.team));
      let runs = 0, wk = 0, legal = 0, pos = 0;
      const ph = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // runs, balls, wkts per phase
      const order = { bat: [], bowl: [] };
      const batOf = (n) => { const id = pid(n), l = L(id, bt); if (!l.bats[ii]) { l.bats[ii] = NEWBAT(++pos); order.bat.push(id); } return l.bats[ii]; };
      const bowlOf = (n) => { const id = pid(n), l = L(id, fieldTeam); if (!l.bowls[ii]) { l.bowls[ii] = NEWBOWL(); order.bowl.push(id); } return l.bowls[ii]; };
      for (const o of inn.overs || []) {
        const p = phaseOf(fmt, o.over);
        const overBy = new Map(); // bowler name -> [legal balls, conceded] for maidens
        for (const d of o.deliveries) {
          const bat = batOf(d.batter); batOf(d.non_striker);
          const bw = bowlOf(d.bowler);
          const batL = lines[pid(d.batter)], bwL = lines[pid(d.bowler)];
          const ex = d.extras || {};
          const wide = !!ex.wides, nb = !!ex.noballs, isLegal = !wide && !nb;
          runs += d.runs.total;
          if (isLegal) legal++;
          const rb = d.runs.batter, four = rb === 4 && !d.runs.non_boundary, six = rb === 6 && !d.runs.non_boundary;
          bat.r += rb; if (!wide) bat.b++; if (!wide && rb === 0) bat.d++; if (four) bat.f++; if (six) bat.s++;
          const conceded = rb + (ex.wides || 0) + (ex.noballs || 0);
          bw.r += conceded; if (isLegal) bw.b++;
          if (isLegal && conceded === 0) bw.d++; if (four) bw.f++; if (six) bw.s++;
          if (wide) bw.wd++; if (nb) bw.nb++;
          { const ob = overBy.get(d.bowler) || [0, 0]; if (isLegal) ob[0]++; ob[1] += conceded; overBy.set(d.bowler, ob); }
          if (p >= 0) {
            ph[p][0] += d.runs.total; if (isLegal) ph[p][1]++;
            batL.ph.bat[p][0] += rb; if (!wide) batL.ph.bat[p][1]++;
            if (isLegal) bwL.ph.bowl[p][0]++; bwL.ph.bowl[p][1] += conceded;
          }
          let creditOut = false;
          for (const w of d.wickets || []) {
            if (w.kind === "retired hurt" || w.kind === "retired not out") continue;
            wk++; if (p >= 0) ph[p][2]++;
            const out = batOf(w.player_out);
            out.out = true; out.how = w.kind;
            // dismissal as [kind, fielder id | "sub:"+name, bowler id] for the scorecard
            const f0 = w.fielders?.[0];
            out.dis = [w.kind, f0?.name ? (f0.substitute ? "sub:" + f0.name : pid(f0.name)) : null, BOWLER_WKT.has(w.kind) ? pid(d.bowler) : null];
            if (BOWLER_WKT.has(w.kind)) { bw.w++; bw.k[w.kind] = (bw.k[w.kind] || 0) + 1; if (p >= 0) bwL.ph.bowl[p][2]++; if (w.player_out === d.batter) creditOut = true; }
            const fl = w.fielders?.[0]?.name;
            if (fl && (w.kind === "caught" || w.kind === "stumped")) { const fl2 = L(pid(fl), fieldTeam); if (w.kind === "stumped") fl2.st++; else fl2.ct++; }
            if (w.kind === "caught and bowled") bwL.ct++;
            if (w.kind === "run out") for (const fx of w.fielders || []) if (fx.name && !fx.substitute) L(pid(fx.name), fieldTeam).ro++;
          }
          // batter vs bowler
          const key = pid(d.batter) + "|" + pid(d.bowler);
          const m = bvb[fmt].get(key) || [0, 0, 0, 0, 0, 0];
          if (!wide) m[0]++; m[1] += rb; if (creditOut) m[2]++; if (isLegal && d.runs.total === 0) m[3]++; if (four) m[4]++; if (six) m[5]++;
          bvb[fmt].set(key, m);
        }
        if (overBy.size === 1) for (const [bn, [lg, cn]] of overBy) if (lg >= bpo && cn === 0) bowlOf(bn).md++;
      }
      inns.push({ t: bt, r: runs, w: wk, b: legal, ov: ovs(legal, bpo), dec: !!inn.declared, ph, order });
    }
    // innings-keyed objects -> chronological arrays; bat/bowl keep match totals for older consumers
    for (const l of Object.values(lines)) {
      l.batsByInn = l.bats; l.bowlsByInn = l.bowls;
      l.bats = Object.values(l.bats); l.bowls = Object.values(l.bowls);
      l.bat = l.bats.length ? l.bats.reduce((a, x) => ({ r: a.r + x.r, b: a.b + x.b, out: a.out + (x.out ? 1 : 0) }), { r: 0, b: 0, out: 0 }) : null;
      l.bowl = l.bowls.length ? l.bowls.reduce((a, x) => ({ b: a.b + x.b, r: a.r + x.r, w: a.w + x.w }), { b: 0, r: 0, w: 0 }) : null;
    }
    // scorecard rows, in batting and bowling order
    for (const [ii, inn] of inns.entries()) {
      const bat = inn.order.bat.map((id) => { const x = lines[id].batsByInn[ii]; return x ? [id, x.r, x.b, x.f, x.s, x.out ? x.dis || [x.how] : null] : null; }).filter(Boolean);
      const bowl = inn.order.bowl.map((id) => { const x = lines[id].bowlsByInn[ii]; return x ? [id, ovs(x.b, bpo), x.md, x.r, x.w, x.wd, x.nb] : null; }).filter(Boolean);
      inn.card = { bat, bowl, ex: inn.r - bat.reduce((t, r) => t + r[1], 0) };
      delete inn.order;
    }
    for (const l of Object.values(lines)) { delete l.batsByInn; delete l.bowlsByInn; }

    const o = info.outcome || {};
    const winner = o.winner ? code(o.winner) : o.eliminator ? code(o.eliminator) : null;
    const res = o.winner ? "W" : o.result === "draw" ? "D" : o.result === "tie" ? (o.eliminator ? "W" : "T") : o.result === "no result" ? "NR" : "NR";
    const by = o.by ? (o.by.innings ? `inns & ${o.by.runs} runs` : o.by.runs != null ? `${o.by.runs} runs` : `${o.by.wickets} wkts`) : o.eliminator ? "super over" : "";
    const rawCity = info.city || VENUE_CITY[info.venue] || null;
    const city = CITY_ALIAS[rawCity] || rawCity;
    const vn = info.venue.split(",")[0].trim();
    const venueName = VENUE_ALIAS[vn] || vn;
    matches.push({
      id: f.replace(".json", ""), f: fmt, d: info.dates[0], days: info.dates.length, venue: venueName, city,
      t: info.teams.map(code), w: winner, res, by, dl: !!o.method,
      toss: info.toss ? [code(info.toss.winner), info.toss.decision] : null,
      b1: inns[0]?.t || null, inns, overs: info.overs || null, lines, event: info.event?.name || null,
      mno: info.event?.match_number || null, pom: (info.player_of_match || []).map(pid),
    });
  }
}
matches.sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
const BUILD_DATE = matches.at(-1).d;
console.log(`parsed ${matches.length} matches up to ${BUILD_DATE}`);

/* ---------------- 2. geocode venues ---------------- */
const geoCache = readJSON(path.join(CACHE, "geo.json"), {});
async function geocode(name, cc) {
  const key = `${name}|${cc || ""}`;
  if (key in geoCache) return geoCache[key];
  const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en${cc ? "&countryCode=" + cc : ""}`;
  const j = await (await fetch(u)).json();
  geoCache[key] = (j.results || []).map((r) => ({ lat: r.latitude, lon: r.longitude, cc: r.country_code, a1: r.admin1 || "", pop: r.population || 0 }));
  return geoCache[key];
}
async function locate(city, homeCCs) {
  if (!city) return null;
  if (CITY_FIX[city]) { const [cc, lat, lon] = CITY_FIX[city]; return { lat, lon, cc, a1: "", pop: 0 }; }
  if (CITY_CC[city]) { const r = await geocode(city, CITY_CC[city]); if (r[0]) return r[0]; }
  const cands = [...(await geocode(city))];
  for (const cc of homeCCs) { const r = await geocode(city, cc); if (r[0]) cands.push({ ...r[0], home: true }); }
  if (!cands.length) return null;
  return cands.reduce((best, c) => ((c.pop || 1) * (c.home ? 1.5 : 1) > (best.pop || 1) * (best.home ? 1.5 : 1) ? c : best));
}
function homeTeamFor(loc, teams) {
  if (!loc) return null;
  for (const t of teams) {
    const T = TEAMS[t]; if (!T) continue;
    if (t === "ENG" && loc.cc === "GB" && !/Scotland|Northern Ireland/.test(loc.a1)) return t;
    if (t === "IRE" && (loc.cc === "IE" || (loc.cc === "GB" && /Northern Ireland/.test(loc.a1)))) return t;
    if (t === "SCO") { if (loc.cc === "GB" && /Scotland/.test(loc.a1)) return t; continue; }
    if (t !== "ENG" && t !== "IRE" && T.cc.includes(loc.cc)) return t;
  }
  return "N";
}
const locByCity = {};
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); };
{
  const jobs = new Map();
  for (const m of matches) {
    const ccs = m.t.flatMap((t) => TEAMS[t]?.cc || []);
    const k = `${m.city}|${ccs.join(",")}`;
    if (!jobs.has(k)) jobs.set(k, { city: m.city, ccs });
    m._lk = k;
  }
  await pool([...jobs.entries()], 6, async ([k, j]) => { locByCity[k] = await locate(j.city, j.ccs); });
  writeJSON(path.join(CACHE, "geo.json"), geoCache);
  for (const m of matches) { m.loc = locByCity[m._lk]; m.h = homeTeamFor(m.loc, m.t); delete m._lk; }
  const unk = matches.filter((m) => !m.loc).length;
  console.log(`geocoded; ${unk} matches without a location`);
}

/* ---------------- 3. match-day weather ---------------- */
{
  const wxCache = readJSON(path.join(CACHE, "weather.json"), {});
  const byLoc = new Map();
  for (const m of matches) {
    if (!m.loc) continue;
    const k = `${m.loc.lat.toFixed(2)},${m.loc.lon.toFixed(2)}`;
    m._wk = k;
    if (!byLoc.has(k)) byLoc.set(k, new Set());
    for (let i = 0; i < Math.min(m.days, 5); i++) byLoc.get(k).add(new Date(Date.parse(m.d) + i * 864e5).toISOString().slice(0, 10));
  }
  const VARS = "temperature_2m_max,precipitation_sum,relative_humidity_2m_mean,cloud_cover_mean,dew_point_2m_mean,wind_speed_10m_max";
  // Open-Meteo bills a request per 2 weeks of data, so fetch short windows around match dates only.
  // Resumable: the cache is saved as we go; if the hourly limit is hit we stop and fill the rest next run.
  const cutoff = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const windows = [];
  for (const [k, dates] of byLoc) {
    const have = wxCache[k] ||= {};
    const need = [...dates].filter((d) => !(d in have) && d <= cutoff).sort();
    let cur = null;
    for (const d of need) {
      if (cur && (Date.parse(d) - Date.parse(cur.from)) / 864e5 < 14) cur.to = d;
      else windows.push((cur = { k, from: d, to: d }));
    }
  }
  console.log(`weather: ${windows.length} windows to fetch`);
  let fetched = 0, limited = false;
  await pool(windows, 3, async ({ k, from, to }) => {
    if (limited) return;
    const [lat, lon] = k.split(",");
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}&daily=${VARS}&timezone=auto`;
    try {
      const r = await fetch(u);
      if (r.status === 429) { limited = true; return; }
      const dly = (await r.json()).daily; if (!dly) return;
      dly.time.forEach((d, i) => { wxCache[k][d] = [dly.temperature_2m_max[i], dly.precipitation_sum[i], dly.relative_humidity_2m_mean[i], dly.cloud_cover_mean[i], dly.dew_point_2m_mean[i], dly.wind_speed_10m_max[i]]; });
      if (++fetched % 100 === 0) { writeJSON(path.join(CACHE, "weather.json"), wxCache); console.log(`  weather ${fetched}/${windows.length}`); }
      await new Promise((s) => setTimeout(s, 250));
    } catch {}
  });
  writeJSON(path.join(CACHE, "weather.json"), wxCache);
  if (limited) console.log(`weather: hit the Open-Meteo rate limit after ${fetched} requests; rerun later to fill the rest`);
  for (const m of matches) {
    const w = m._wk && wxCache[m._wk]; delete m._wk;
    const day1 = w?.[m.d];
    if (!day1 || day1[0] == null) { m.wx = null; continue; }
    let rain = 0;
    for (let i = 0; i < Math.min(m.days, 5); i++) rain += w[new Date(Date.parse(m.d) + i * 864e5).toISOString().slice(0, 10)]?.[1] || 0;
    m.wx = [r1(day1[0]), r1(rain), Math.round(day1[2]), Math.round(day1[3]), r1(day1[4]), Math.round(day1[5])]; // tmax, rain(mm, all days), rh, cloud, dewpt, wind
  }
  console.log(`weather: ${fetched} requests; ${matches.filter((m) => m.wx).length}/${matches.length} matches with weather`);
}

/* ---------------- 4. surface proxy: first-innings total terciles (since 2015) ---------------- */
const SURF = {};
for (const fmt of ["T20I", "ODI", "Test"]) {
  const xs = matches.filter((m) => m.f === fmt && m.d >= "2015" && m.inns[0] && !m.dl && m.res !== "NR" && MAJORS.has(m.t[0]) && MAJORS.has(m.t[1]))
    .map((m) => m.inns[0].r).sort((a, b) => a - b);
  SURF[fmt] = [xs[Math.floor(xs.length / 3)], xs[Math.floor((2 * xs.length) / 3)]];
}
for (const m of matches) {
  const i = m.inns[0];
  m.sf = !i || m.dl || m.res === "NR" ? null : i.r >= SURF[m.f][1] ? "h" : i.r < SURF[m.f][0] ? "l" : "m";
}

/* ---------------- 5. venues ---------------- */
const venues = {};
for (const m of matches) {
  const id = slug(m.venue + (m.city ? "-" + m.city : ""));
  m.v = id;
  const V = (venues[id] ||= { id, name: m.venue, city: m.city, cc: m.loc?.cc || null, lat: m.loc?.lat ?? null, lon: m.loc?.lon ?? null, fmt: {} });
  const F = (V.fmt[m.f] ||= { p: 0, res: 0, b1w: 0, chw: 0, tossBat: 0, toss: 0, tossWon: 0, tossDec: 0, s1: [], s2: [], ph: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], last: null, wx: [0, 0, 0, 0, 0], nwx: 0, hi: null, lo: null });
  F.p++; F.last = m.d; F.first ||= m.d;
  if (m.toss) { F.toss++; if (m.toss[1] === "bat") F.tossBat++; if (m.res === "W") { F.tossDec++; if (m.w === m.toss[0]) F.tossWon++; } }
  if (m.res === "W" && m.b1) { F.res++; if (m.w === m.b1) F.b1w++; else F.chw++; }
  if (!m.dl && m.inns[0] && m.res !== "NR") F.s1.push(m.inns[0].r);
  if (!m.dl && m.inns[1] && m.f !== "Test" && m.res !== "NR") F.s2.push(m.inns[1].r);
  for (const inn of m.inns.slice(0, 2)) inn.ph.forEach((p, i) => { F.ph[i][0] += p[0]; F.ph[i][1] += p[1]; F.ph[i][2] += p[2]; });
  for (const inn of m.inns) {
    const s = { r: inn.r, w: inn.w, t: inn.t, d: m.d };
    if (!F.hi || inn.r > F.hi.r) F.hi = s;
    if (m.f !== "Test" && inn.w === 10 && (!F.lo || inn.r < F.lo.r)) F.lo = s;
  }
  if (m.wx) { F.nwx++; F.wx = F.wx.map((x, i) => x + [m.wx[0], m.wx[2], m.wx[3], m.wx[4], m.wx[1]][i]); }
}
for (const V of Object.values(venues)) for (const F of Object.values(V.fmt)) {
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  F.avg1 = avg(F.s1); F.avg2 = avg(F.s2); delete F.s1; delete F.s2;
  F.ph = F.ph.map(([r, b, w]) => (b ? [r1((r / b) * 6), r1((w / b) * 60)] : null)); // run rate, wkts per 10 overs
  F.wx = F.nwx ? F.wx.map((x) => r1(x / F.nwx)) : null; delete F.nwx; // avg tmax, rh, cloud, dew, rain
  if (F.hi) F.hi = [F.hi.r, F.hi.w, F.hi.t, F.hi.d];
  if (F.lo) F.lo = [F.lo.r, F.lo.w, F.lo.t, F.lo.d];
}

/* ---------------- 6. compact match records ---------------- */
const compact = (m) => ({
  id: m.id, f: m.f, d: m.d, v: m.v, h: m.h, t: m.t, w: m.w, res: m.res, by: m.by, dl: m.dl || undefined,
  toss: m.toss, b1: m.b1, s: m.inns.map((i) => [i.t, i.r, i.w, i.ov, i.dec ? 1 : 0]), wx: m.wx, sf: m.sf, ev: m.event,
});

/* ---------------- 6b. full player names ---------------- */
// Cricsheet names players by initials ("JJ Bumrah"). Prefer a full variant from Cricsheet's own register,
// then ask Gemini Flash (cached, once per player) for recent players the register can't resolve.
{
  const reg = new Map();
  for (const line of (readFile(path.join(CACHE, "names.csv")) || "").split(/\r?\n/).slice(1)) {
    const i = line.indexOf(","); if (i < 0) continue;
    const id = line.slice(0, i), name = line.slice(i + 1).replace(/^"|"$/g, "");
    if (!reg.has(id)) reg.set(id, []); reg.get(id).push(name);
  }
  const isInitials = (tok) => /^[A-Z]{1,4}$/.test(tok);
  const surname = (n) => n.split(" ").slice(-1)[0];
  const fromRegister = (id, short) => {
    const c = (reg.get(id) || []).filter((v) => { const t = v.split(" "); return t.length >= 2 && !isInitials(t[0]) && t[0].length >= 3 && surname(v) === surname(short); });
    return c.sort((a, b) => a.split(" ").length - b.split(" ").length || a.length - b.length)[0] || null;
  };
  const cachePath = path.join(CACHE, "fullnames.json"), aiNames = readJSON(cachePath, {});
  const recent = new Map(); // id -> team, for players active since 2018
  for (const m of matches) if (m.d >= "2018") for (const [id, l] of Object.entries(m.lines)) recent.set(id, l.team);
  const resolved = {};
  const ask = [];
  for (const [id, short] of Object.entries(people)) {
    if (!isInitials(short.split(" ")[0])) continue; // already a full name
    const r = fromRegister(id, short) || aiNames[id];
    if (r) resolved[id] = r; else if (recent.has(id) && !(id in aiNames)) ask.push({ id, name: short, team: TEAMS[recent.get(id)]?.name || recent.get(id) });
  }
  const key = process.env.GEMINI_API_KEY || (readFile(path.join(ROOT, ".env")) || "").match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
  const model = process.env.GEMINI_MODEL || (readFile(path.join(ROOT, ".env")) || "").match(/^GEMINI_MODEL=(.+)$/m)?.[1]?.trim() || "gemini-3.8-flash";
  if (ask.length && key) {
    console.log(`names: asking Gemini about ${ask.length} players`);
    for (let i = 0; i < ask.length; i += 80) {
      const batch = ask.slice(i, i + 80);
      console.log(`  names ${i}/${ask.length}`);
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "These are international cricketers listed by initials and surname, with their team. Give each player's commonly used full name as ESPNcricinfo shows it (e.g. 'SA Yadav' for India is 'Suryakumar Yadav'). Keep the same surname. If you are not confident, return the name unchanged.\n" + JSON.stringify(batch) }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, full: { type: "STRING" } }, required: ["id", "full"] } } },
          }),
        });
        const j = await r.json();
        const out = JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
        for (const { id } of batch) aiNames[id] = null; // asked; don't ask again
        for (const { id, full } of out) {
          const short = people[id];
          if (short && full && surname(full) === surname(short) && !isInitials(full.split(" ")[0])) aiNames[id] = full;
        }
        writeJSON(cachePath, aiNames); // keep progress if the build is interrupted
      } catch (e) { console.log("names: Gemini batch failed", String(e).slice(0, 120)); }
    }
    writeJSON(cachePath, aiNames);
    for (const { id } of ask) if (aiNames[id]) resolved[id] = aiNames[id];
  }
  for (const [id, n] of Object.entries(resolved)) people[id] = n;
  console.log(`names: ${Object.keys(resolved).length} expanded to full names`);
}

/* ---------------- 7. players & squads ---------------- */
function playerStats(id, list) {
  // list: chronological [{m, l}] for one format
  const S = { m: list.length, inn: 0, r: 0, b: 0, no: 0, f: 0, s: 0, hs: 0, hsNo: false, c50: 0, c100: 0, bb: 0, br: 0, bw: 0, best: null, ct: 0, st: 0, binn: 0, ph: { bat: [[0, 0], [0, 0], [0, 0]], bowl: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] }, posSum: 0 };
  for (const { m, l } of list) {
    S.ct += l.ct; S.st += l.st;
    l.ph.bat.forEach((p, i) => { S.ph.bat[i][0] += p[0]; S.ph.bat[i][1] += p[1]; });
    l.ph.bowl.forEach((p, i) => { S.ph.bowl[i][0] += p[0]; S.ph.bowl[i][1] += p[1]; S.ph.bowl[i][2] += p[2]; });
    for (const x of l.bats) {
      if (!x.b && !x.out) continue;
      S.inn++; S.r += x.r; S.b += x.b; S.f += x.f; S.s += x.s; S.posSum += x.pos;
      if (!x.out) S.no++;
      if (x.r > S.hs || (x.r === S.hs && !x.out)) { S.hs = x.r; S.hsNo = !x.out; }
      if (x.r >= 100) S.c100++; else if (x.r >= 50) S.c50++;
    }
    for (const x of l.bowls) {
      if (!x.b) continue;
      S.binn++; S.bb += x.b; S.br += x.r; S.bw += x.w;
      if (!S.best || x.w > S.best[0] || (x.w === S.best[0] && x.r < S.best[1])) S.best = [x.w, x.r];
    }
  }
  const outs = S.inn - S.no;
  return {
    m: S.m, inn: S.inn, r: S.r, b: S.b, avg: outs ? r1(S.r / outs) : null, sr: S.b ? r1((S.r / S.b) * 100) : null, hs: S.inn ? `${S.hs}${S.hsNo ? "*" : ""}` : null,
    c50: S.c50, c100: S.c100, f: S.f, s: S.s, pos: S.inn ? r1(S.posSum / S.inn) : null,
    binn: S.binn, bb: S.bb, w: S.bw, bavg: S.bw ? r1(S.br / S.bw) : null, econ: S.bb ? r1((S.br / S.bb) * 6) : null, bsr: S.bw ? r1(S.bb / S.bw) : null,
    best: S.best ? `${S.best[0]}/${S.best[1]}` : null, ct: S.ct, st: S.st,
    phBat: S.ph.bat.map(([r, b]) => (b >= 30 ? r1((r / b) * 100) : null)),
    phBowl: S.ph.bowl.map(([b, r, w]) => (b >= 30 ? [r1((r / b) * 6), w] : null)),
  };
}
function role(s) {
  // batting weight: runs per innings and average batting position; bowling weight: share of matches bowled in
  const rpi = s.inn ? s.r / s.inn : 0, bowlW = s.binn / Math.max(1, s.m), pos = s.pos || 11;
  if (s.st > 0 || (s.ct > s.m * 0.9 && s.binn === 0)) return "WK";
  const bats = rpi >= 18 || pos <= 6.5 || (pos <= 7.6 && rpi >= 11);
  if (bowlW >= 0.45 && bats) return "AR";
  if (bowlW >= 0.45) return "BOWL";
  if (bowlW >= 0.25 && bats && s.w >= 5) return "AR";
  return "BAT";
}

const byTeamFmt = {}; // code -> fmt -> [matches]
for (const m of matches) for (const t of m.t) if (TEAMS[t]) ((byTeamFmt[t] ||= {})[m.f] ||= []).push(m);

const squads = {}; // code -> fmt -> [pid]
const teamFiles = {};
for (const code of Object.keys(TEAMS)) {
  const T = { code, name: TEAMS[code].name, built: BUILD_DATE, formats: {} };
  for (const fmt of ["T20I", "ODI", "Test"]) {
    const ms = byTeamFmt[code]?.[fmt] || [];
    if (!ms.length) continue;
    const recent = ms.slice(-8);
    const apps = new Map();
    recent.forEach((m, i) => { for (const [id, l] of Object.entries(m.lines)) if (l.team === code) { const a = apps.get(id) || { n: 0, last: -1, recent5: 0 }; a.n++; a.last = i; if (i >= recent.length - 5) a.recent5++; apps.set(id, a); } });
    const last5 = recent.slice(-5);
    const ids = [...apps.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).slice(0, 20).map(([id]) => id);
    (squads[code] ||= {})[fmt] = ids;
    const lastYear = (m) => daysAgo(m.d, BUILD_DATE) <= 365;
    const players = ids.map((id) => {
      const list = ms.filter((m) => m.lines[id]?.team === code).map((m) => ({ m, l: m.lines[id] }));
      const career = playerStats(id, list);
      const y1 = playerStats(id, list.filter(({ m }) => lastYear(m)));
      const opp = (m) => m.t.find((x) => x !== code);
      const bat5 = list.flatMap(({ m, l }) => l.bats.filter((x) => x.b > 0 || x.out).map((x) => [m.d, opp(m), x.r, x.b, x.out ? 1 : 0, x.pos, m.id])).slice(-5);
      const bowl5 = list.flatMap(({ m, l }) => l.bowls.filter((x) => x.b).map((x) => [m.d, opp(m), ovs(x.b), x.r, x.w, m.id])).slice(-5);
      const vs = {};
      for (const { m, l } of list) {
        const o = opp(m); if (!TEAMS[o]) continue;
        const v = (vs[o] ||= [0, 0, 0, 0, 0, 0, 0, 0]); // m, inns, runs, balls, outs, bowl balls, bowl runs, wkts
        v[0]++; for (const x of l.bats) { if (!(x.b > 0 || x.out)) continue; v[1]++; v[2] += x.r; v[3] += x.b; v[4] += x.out ? 1 : 0; }
        if (l.bowl) { v[5] += l.bowl.b; v[6] += l.bowl.r; v[7] += l.bowl.w; }
      }
      const a = apps.get(id);
      return { id, n: people[id], role: role(career), apps: [a.recent5, Math.min(5, recent.length)], a5: last5.map((m) => (m.lines[id]?.team === code ? "1" : "0")).join(""), lastPlayed: list.at(-1)?.m.d, career, y1, bat5, bowl5, vs };
    });
    const compactMs = ms.map(compact);
    T.formats[fmt] = { matches: compactMs, squad: players, since: ms[0].d };
  }
  teamFiles[code] = T;
}

/* ---------------- 7b. full player profiles (everyone who has played for the team since 2018) ---------------- */
const PROFILE_SINCE = "2018-01-01";
function profile(id, list, code) {
  // list: chronological [{m, l}] for one format. Arrays are compact: bat splits [inn, runs, balls, outs], bowl splits [balls, runs, wkts].
  const B = { m: list.length, inn: 0, no: 0, r: 0, b: 0, d: 0, f: 0, s: 0, hs: -1, hsNo: false, c100: 0, c50: 0, z: 0, posSum: 0, how: {}, ph: [[0, 0], [0, 0], [0, 0]], sp: {}, vs: {}, yr: {}, last: [] };
  const W = { inn: 0, b: 0, r: 0, w: 0, d: 0, f: 0, s: 0, wd: 0, nb: 0, md: 0, w4: 0, w5: 0, w10: 0, best: null, k: {}, ph: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], sp: {}, vs: {}, yr: {}, last: [] };
  const F = { ct: 0, st: 0, ro: 0 };
  const addB = (o, k, l) => { const a = (o[k] ||= [0, 0, 0, 0]); a[0]++; a[1] += l.r; a[2] += l.b; a[3] += l.out ? 1 : 0; };
  const addW = (o, k, l) => { const a = (o[k] ||= [0, 0, 0]); a[0] += l.b; a[1] += l.r; a[2] += l.w; };
  const y1 = (m) => daysAgo(m.d, BUILD_DATE) <= 365;
  const byMatchW = new Map();
  for (const { m, l } of list) {
    F.ct += l.ct; F.st += l.st; F.ro += l.ro;
    const opp = m.t.find((x) => x !== code), yr = m.d.slice(0, 4);
    const where = m.h === code ? "home" : m.h === "N" || !m.h ? "neutral" : "away";
    const order = m.b1 === code ? "bat1" : m.b1 ? "chase" : null;
    l.ph.bat.forEach((p, i) => { B.ph[i][0] += p[0]; B.ph[i][1] += p[1]; });
    l.ph.bowl.forEach((p, i) => { W.ph[i][0] += p[0]; W.ph[i][1] += p[1]; W.ph[i][2] += p[2]; });
    for (const x of l.bats) {
      if (!x.b && !x.out) continue;
      B.inn++; B.r += x.r; B.b += x.b; B.d += x.d; B.f += x.f; B.s += x.s; B.posSum += x.pos;
      if (!x.out) B.no++; else B.how[x.how] = (B.how[x.how] || 0) + 1;
      if (x.out && x.r === 0) B.z++;
      if (x.r > B.hs || (x.r === B.hs && !x.out)) { B.hs = x.r; B.hsNo = !x.out; }
      if (x.r >= 100) B.c100++; else if (x.r >= 50) B.c50++;
      addB(B.sp, where, x); if (order) addB(B.sp, order, x); if (y1(m)) addB(B.sp, "y1", x);
      addB(B.vs, opp, x); addB(B.yr, yr, x);
      B.last.push([m.d, opp, x.r, x.b, x.out ? 1 : 0, x.how === "not out" ? "" : x.how, m.id]);
    }
    for (const x of l.bowls) {
      if (!(x.b + x.wd + x.nb)) continue;
      W.inn++; W.b += x.b; W.r += x.r; W.w += x.w; W.d += x.d; W.f += x.f; W.s += x.s; W.wd += x.wd; W.nb += x.nb; W.md += x.md;
      for (const [k, v] of Object.entries(x.k)) W.k[k] = (W.k[k] || 0) + v;
      if (x.w >= 5) W.w5++; else if (x.w >= 4) W.w4++;
      if (!W.best || x.w > W.best[0] || (x.w === W.best[0] && x.r < W.best[1])) W.best = [x.w, x.r];
      addW(W.sp, where, x); if (order) addW(W.sp, order === "bat1" ? "def" : "chaseB", x); if (y1(m)) addW(W.sp, "y1", x);
      addW(W.vs, opp, x); addW(W.yr, yr, x);
      { const t = byMatchW.get(m.id) || [0, 0]; t[0] += x.w; t[1] += x.r; byMatchW.set(m.id, t); }
      W.last.push([m.d, opp, ovs(x.b), x.r, x.w, x.md, m.id]);
    }
  }
  let bbm = null;
  for (const [w, r] of byMatchW.values()) { if (w >= 10) W.w10++; if (!bbm || w > bbm[0] || (w === bbm[0] && r < bbm[1])) bbm = [w, r]; }
  const outs = B.inn - B.no;
  const bat = B.inn ? {
    m: B.m, inn: B.inn, no: B.no, r: B.r, b: B.b, hs: `${B.hs}${B.hsNo ? "*" : ""}`, avg: outs ? r1(B.r / outs) : null, sr: B.b ? r1((100 * B.r) / B.b) : null,
    c100: B.c100, c50: B.c50, z: B.z, f: B.f, s: B.s, dot: B.b ? Math.round((100 * B.d) / B.b) : null, bnd: B.b ? Math.round((100 * (B.f + B.s)) / B.b) : null,
    bpb: B.f + B.s ? r1(B.b / (B.f + B.s)) : null, pos: r1(B.posSum / B.inn), how: B.how,
    ph: B.ph.map(([r, b]) => (b >= 30 ? [r1((100 * r) / b), b] : null)), sp: B.sp, vs: B.vs, yr: B.yr, last: B.last.slice(-10),
  } : null;
  const bowl = W.inn ? {
    inn: W.inn, b: W.b, ov: ovs(W.b), r: W.r, w: W.w, md: W.md, best: W.best ? `${W.best[0]}/${W.best[1]}` : null,
    bbm: bbm ? `${bbm[0]}/${bbm[1]}` : null, avg: W.w ? r1(W.r / W.w) : null, econ: W.b ? r1((6 * W.r) / W.b) : null, sr: W.w ? r1(W.b / W.w) : null, w4: W.w4, w5: W.w5, w10: W.w10,
    dot: W.b ? Math.round((100 * W.d) / W.b) : null, f: W.f, s: W.s, wd: W.wd, nb: W.nb, k: W.k,
    ph: W.ph.map(([b, r, w]) => (b >= 30 ? [r1((6 * r) / b), w, b] : null)), sp: W.sp, vs: W.vs, yr: W.yr, last: W.last.slice(-10),
  } : null;
  return { m: list.length, from: list[0].m.d, to: list.at(-1).m.d, bat, bowl, field: F };
}
const PLAYER_SETS = {};
for (const code of Object.keys(TEAMS)) {
  const ids = new Map(); // id -> last date
  for (const fmt of ["T20I", "ODI", "Test"]) for (const m of byTeamFmt[code]?.[fmt] || []) {
    if (m.d < PROFILE_SINCE) continue;
    for (const [id, l] of Object.entries(m.lines)) if (l.team === code) ids.set(id, m.d);
  }
  PLAYER_SETS[code] = new Set(ids.keys());
  if (!ids.size) continue;
  const players = [...ids.keys()].map((id) => {
    const fmts = {};
    let roleSrc = null, roleM = 0;
    for (const fmt of ["T20I", "ODI", "Test"]) {
      const list = (byTeamFmt[code]?.[fmt] || []).filter((m) => m.lines[id]?.team === code).map((m) => ({ m, l: m.lines[id] }));
      if (!list.length) continue;
      fmts[fmt] = profile(id, list, code);
      const ps = playerStats(id, list);
      if (ps.m > roleM) { roleM = ps.m; roleSrc = ps; }
    }
    return { id, n: people[id], role: role(roleSrc), last: ids.get(id), f: fmts };
  }).sort((a, b) => b.last.localeCompare(a.last));
  writeJSON(path.join(OUT, "players", `${code}.json`), { code, built: BUILD_DATE, since: PROFILE_SINCE, players });
}

/* ---------------- 8. pair files ---------------- */
const byPair = new Map();
for (const m of matches) { const k = [...m.t].sort().join("-"); if (!byPair.has(k)) byPair.set(k, []); byPair.get(k).push(m); }
let pairCount = 0;
const pairIndex = [];
fs.rmSync(path.join(OUT, "pairs"), { recursive: true, force: true });
for (const [key, ms] of byPair) {
  const [A, B] = key.split("-");
  if (!TEAMS[A] || !TEAMS[B] || A === B) continue;
  const cnt = { T20I: 0, ODI: 0, Test: 0 }; for (const m of ms) cnt[m.f]++;
  pairIndex.push([A, B, cnt.T20I, cnt.ODI, cnt.Test, ms.at(-1).d]);
  const P = { a: A, b: B, built: BUILD_DATE, matches: ms.map(compact), top: {}, matchups: {} };
  for (const fmt of ["T20I", "ODI", "Test"]) {
    const fm = ms.filter((m) => m.f === fmt);
    // top performers in this rivalry
    const agg = {};
    for (const m of fm) for (const [id, l] of Object.entries(m.lines)) {
      if (l.team !== A && l.team !== B) continue;
      const g = (agg[id] ||= { id, n: people[id], t: l.team, m: 0, r: 0, b: 0, outs: 0, w: 0, bb: 0, br: 0, last: m.d });
      g.m++; g.last = m.d;
      if (l.bat) { g.r += l.bat.r; g.b += l.bat.b; g.outs += l.bat.out; }
      if (l.bowl) { g.w += l.bowl.w; g.bb += l.bowl.b; g.br += l.bowl.r; }
    }
    const all = Object.values(agg);
    P.top[fmt] = {
      bat: all.filter((g) => g.r > 0).sort((x, y) => y.r - x.r).slice(0, 8).map((g) => [g.id, g.n, g.t, g.m, g.r, g.outs ? r1(g.r / g.outs) : null, g.b ? r1((g.r / g.b) * 100) : null, g.last]),
      bowl: all.filter((g) => g.w > 0).sort((x, y) => y.w - x.w || x.br - y.br).slice(0, 8).map((g) => [g.id, g.n, g.t, g.m, g.w, r1(g.br / g.w), g.bb ? r1((g.br / g.bb) * 6) : null, g.last]),
    };
    // batter-vs-bowler among everyone who has played for either side since 2018
    const sqA = PLAYER_SETS[A] || new Set(), sqB = PLAYER_SETS[B] || new Set();
    const mu = [];
    for (const [k, v] of bvb[fmt]) {
      if (v[0] < 6) continue;
      const [bat, bowl] = k.split("|");
      if ((sqA.has(bat) && sqB.has(bowl)) || (sqB.has(bat) && sqA.has(bowl))) mu.push([bat, bowl, ...v]);
    }
    mu.sort((x, y) => y[2] - x[2]);
    P.matchups[fmt] = mu.slice(0, 1500);
  }
  P.names = Object.fromEntries([...new Set(Object.values(P.matchups).flat().flatMap((x) => [x[0], x[1]]))].map((id) => [id, people[id]]));
  if (ms.length) { writeJSON(path.join(OUT, "pairs", `${A}-${B}.json`), P); pairCount++; }
}

/* ---------------- 9. write ---------------- */
fs.rmSync(path.join(OUT, "teams"), { recursive: true, force: true });
for (const [code, T] of Object.entries(teamFiles)) if (Object.keys(T.formats).length) writeJSON(path.join(OUT, "teams", `${code}.json`), T);
const usedVenues = Object.fromEntries(Object.entries(venues).filter(([, V]) => Object.values(V.fmt).reduce((s, F) => s + F.p, 0) >= 2 || V.cc));
writeJSON(path.join(OUT, "venues.json"), usedVenues);
const since = Object.fromEntries(["T20I", "ODI", "Test"].map((f) => [f, matches.find((m) => m.f === f)?.d]));
writeJSON(path.join(OUT, "meta.json"), {
  built: BUILD_DATE, generated: new Date().toISOString().slice(0, 10), matches: matches.length, since, surf: SURF,
  teams: Object.fromEntries(Object.entries(TEAMS).map(([k, v]) => [k, { name: v.name, major: MAJORS.has(k), data: !!Object.keys(teamFiles[k]?.formats || {}).length, n: Object.fromEntries(["T20I", "ODI", "Test"].map((f) => [f, byTeamFmt[k]?.[f]?.length || 0])) }])),
  sources: ["Cricsheet (cricsheet.org) ball-by-ball data, ODC-By licence", "Open-Meteo historical weather archive"],
});
// scorecards for the past-match research, one file per month so a match review loads ~50 KB
fs.rmSync(path.join(OUT, "scorecards"), { recursive: true, force: true });
{
  const byMonth = new Map();
  for (const m of matches) { const k = m.d.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(m); }
  for (const [k, ms] of byMonth) {
    const names = {}, out = {};
    const nm = (id) => { if (id && !String(id).startsWith("sub:")) names[id] = people[id]; return id; };
    for (const m of ms) {
      out[m.id] = {
        ev: m.event, mno: m.mno, pom: m.pom.map(nm),
        inns: m.inns.map((i) => ({ t: i.t, r: i.r, w: i.w, ov: i.ov, dec: i.dec ? 1 : 0, ex: i.card.ex, ph: i.ph,
          bat: i.card.bat.map((b) => { nm(b[0]); if (b[5]) { nm(b[5][1]); nm(b[5][2]); } return b; }),
          bowl: i.card.bowl.map((b) => (nm(b[0]), b)) })),
      };
    }
    writeJSON(path.join(OUT, "scorecards", `${k}.json`), { names, matches: out });
  }
}
// every pairing that has played, for the match search: [A, B, T20Is, ODIs, Tests, last date]
writeJSON(path.join(OUT, "pairs-index.json"), pairIndex.sort((x, y) => y[5].localeCompare(x[5])));
console.log(`wrote ${Object.keys(teamFiles).length} teams, ${pairCount} pairs, ${Object.keys(usedVenues).length} venues`);
