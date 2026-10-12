import { getMeta, getVenues, getFixtures, getTeam, getPair, getJSON } from "./data.js";
import { openDossier, closeDossier, homeOf } from "./dossier.js";
import { playIntro } from "./intro.js";
import { initFinder, openFinder } from "./finder.js";
import { initArchive, openArchive, closeArchive } from "./archive.js";

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const TEAMS = {
  IND: { name: "India", c: "#2e7bff" }, AUS: { name: "Australia", c: "#ffcd00" }, ENG: { name: "England", c: "#e4002b" },
  NZ: { name: "New Zealand", c: "#cfd6de" }, SA: { name: "South Africa", c: "#00b25f" }, PAK: { name: "Pakistan", c: "#3ccf7a" },
  SL: { name: "Sri Lanka", c: "#5b74ff" }, BAN: { name: "Bangladesh", c: "#1e9e6a" }, WI: { name: "West Indies", c: "#b0263f" },
  AFG: { name: "Afghanistan", c: "#1a8cff" }, ZIM: { name: "Zimbabwe", c: "#e03c31" }, IRE: { name: "Ireland", c: "#22b573" }, UAE: { name: "UAE", c: "#00a651" },
};
const COUNTRY_TEAM = {
  India: "IND", Australia: "AUS", "United Kingdom": "ENG", "New Zealand": "NZ", "South Africa": "SA", Pakistan: "PAK", "Sri Lanka": "SL", Bangladesh: "BAN",
  Afghanistan: "AFG", Zimbabwe: "ZIM", Ireland: "IRE", "United Arab Emirates": "UAE",
  // the West Indies islands act as one team on the globe
  Netherlands: "NED", Nepal: "NEP", Namibia: "NAM", Oman: "OMA", "United States of America": "USA", Canada: "CAN", "Papua New Guinea": "PNG", "Hong Kong": "HK",
  Jamaica: "WI", "Trinidad and Tobago": "WI", Barbados: "WI", Guyana: "WI", "Antigua and Barb.": "WI", "Saint Lucia": "WI", Grenada: "WI", "St. Vin. and Gren.": "WI", Dominica: "WI", "St. Kitts and Nevis": "WI",
};
const teamOf = (d) => COUNTRY_TEAM[d.properties.name];
const tcol = (d) => TEAMS[teamOf(d)]?.c || "#8fb8de";
const DURATION_H = { T20I: 4, ODI: 9, Test: 5 * 24 };

let meta, venues, fixtures = [], selected = null, hoveredTeam = null, filterIndia = true, view = "india", world, controls;

/* ---------- fixture status, computed from the clock ---------- */
function withStatus(f) {
  const start = new Date(f.start), now = new Date(), end = new Date(start.getTime() + (DURATION_H[f.fmt] || 8) * 36e5);
  const istDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  let status, statusLabel;
  if (f.sample) { status = "upcoming"; statusLabel = "Sample"; }
  else if (f.live && f.ended) { status = "done"; statusLabel = "Completed"; }
  else if ((f.live && f.started) || (!f.live && now >= start && now <= end)) { status = "live"; statusLabel = "Live"; }
  else if (now > end) { status = "done"; statusLabel = "Completed"; }
  else {
    const today = istDay(now), day = istDay(start), tmr = istDay(new Date(now.getTime() + 864e5));
    const t = start.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
    if (day === today) { status = "soon"; statusLabel = `Today ${t}`; }
    else if (day === tmr) { status = "soon"; statusLabel = `Tomorrow ${t}`; }
    else { status = "upcoming"; statusLabel = start.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }); }
  }
  const venue = venues?.[f.venue] ? f.venue : resolveVenue(f.venueName);
  const V = venues?.[venue];
  return { ...f, venue, status, statusLabel, lat: V?.lat, lng: V?.lon, V };
}
// Live fixtures carry a venue string like "Wankhede Stadium, Mumbai"; match it to our venue records.
function resolveVenue(name) {
  if (!name || !venues) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(stadium|cricket|ground|international|the|oval)\b/g, " ").replace(/\s+/g, " ").trim();
  const [vn, city] = name.split(",").map((s) => s.trim());
  const key = norm(vn);
  let best = null, score = 0;
  for (const v of Object.values(venues)) {
    const n = norm(v.name);
    const s = (n === key ? 3 : n.includes(key) || key.includes(n) ? 2 : 0) + (city && v.city?.toLowerCase() === city.toLowerCase() ? 1 : 0);
    const total = Object.values(v.fmt).reduce((t, f) => t + f.p, 0);
    if (s > score || (s === score && s > 0 && total > (best?._n || 0))) { best = { id: v.id, _n: total }; score = s; }
  }
  return score >= 2 ? best.id : null;
}
const statusColor = (s) => (s === "live" ? "#ff4757" : s === "soon" ? "#ffb020" : s === "done" ? "#6f7b95" : "#dfe6f5");
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const visible = () => fixtures.filter((m) => !filterIndia || m.a === "IND" || m.b === "IND");
const locked = () => view === "india" || filterIndia;

/* ---------- globe ---------- */
function starfield() {
  const c = document.createElement("canvas"); c.width = 1600; c.height = 800; const g = c.getContext("2d");
  g.fillStyle = "#04060c"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1600; i++) { const r = Math.random(); g.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${210 + Math.random() * 45 | 0},255,${0.25 + r * 0.75})`; g.beginPath(); g.arc(Math.random() * c.width, Math.random() * c.height, r < 0.97 ? r * 0.8 : 1.4, 0, 7); g.fill(); }
  return c.toDataURL("image/jpeg", 0.8);
}
const isHost = (d) => selected && teamOf(d) === homeOf(selected.V?.cc) && [selected.a, selected.b].includes(teamOf(d));
const isPlaying = (d) => selected && [selected.a, selected.b].includes(teamOf(d));
const isHovered = (d) => hoveredTeam && teamOf(d) === hoveredTeam;

function initGlobe() {
  const el = $("#globe");
  world = new Globe(el, { animateIn: false })
    .globeImageUrl("img/earth.webp")
    .bumpImageUrl("img/bump.webp")
    .backgroundImageUrl(starfield())
    .showAtmosphere(true).atmosphereColor("#69b4ff").atmosphereAltitude(0.17)
    .polygonAltitude((d) => (isHost(d) ? 0.007 : isPlaying(d) ? 0.005 : 0.003))
    .polygonCapColor((d) => {
      const c = tcol(d);
      return isHost(d) ? hexA(c, 0.5) : isPlaying(d) ? hexA(c, 0.26) : isHovered(d) ? hexA(c, 0.26) : teamOf(d) === "IND" ? (filterIndia ? "rgba(255,153,51,0.2)" : "rgba(255,153,51,0.1)") : "rgba(255,255,255,0.02)";
    })
    .polygonSideColor((d) => (isHost(d) ? hexA(tcol(d), 0.22) : "rgba(0,0,0,0)"))
    .polygonStrokeColor((d) => { const c = tcol(d); return isPlaying(d) || isHovered(d) ? c : teamOf(d) === "IND" ? "rgba(255,190,120,0.7)" : filterIndia ? "rgba(220,230,255,0.08)" : "rgba(220,230,255,0.22)"; })
    .polygonLabel((d) => `<div class="ctip">${TEAMS[teamOf(d)]?.name || d.properties.name}</div>`)
    .onPolygonHover((d) => { const t = d ? teamOf(d) : null; el.style.cursor = d ? "pointer" : "grab"; if (t !== hoveredTeam) { hoveredTeam = t; refreshPolys(); } })
    .onPolygonClick((d) => { const t = teamOf(d); const m = visible().find((x) => homeOf(x.V?.cc) === t) || visible().find((x) => x.a === t || x.b === t); if (m) select(m); })
    .polygonsTransitionDuration(450).polygonCapCurvatureResolution(1)
    .ringColor((d) => (t) => hexA(statusColor(d.status), Math.max(0, 1 - t)))
    .ringMaxRadius(3.2).ringPropagationSpeed(2.2).ringRepeatPeriod(1300)
    .htmlLat("lat").htmlLng("lng").htmlAltitude(0.004).htmlElement((x) => (x.ground ? makeGroundPin(x) : makePin(x)));
  const mat = world.globeMaterial(); mat.bumpScale = 8; mat.shininess = 6;
  controls = world.controls();
  controls.autoRotate = false; controls.autoRotateSpeed = 0.35; controls.enableDamping = true;
  controls.minDistance = 130; controls.maxDistance = 900;
  const resize = () => world.width(innerWidth).height(innerHeight);
  addEventListener("resize", resize); resize();
  // country shapes are a separate cached file, loaded after the globe is up
  getJSON("data/countries.json").then((g) => world.polygonsData(g.features));

  let dragging = false;
  el.addEventListener("pointerdown", () => { dragging = true; hideHint(); });
  addEventListener("pointerup", () => (dragging = false));
  el.addEventListener("pointermove", (e) => { if (dragging || selected || reduceMotion || locked()) return; controls.autoRotateSpeed = -(e.clientX / innerWidth - 0.5) * 5; });
  el.addEventListener("pointerleave", () => { if (!selected && !reduceMotion && !locked()) controls.autoRotateSpeed = 0.35; });
  el.addEventListener("wheel", hideHint, { passive: true });
  pinLoop();
}
function refreshPolys() { if (world) world.polygonCapColor(world.polygonCapColor()).polygonStrokeColor(world.polygonStrokeColor()).polygonAltitude(world.polygonAltitude()).polygonSideColor(world.polygonSideColor()); }
function spin(on) { controls.autoRotate = on && !reduceMotion && !locked(); controls.autoRotateSpeed = 0.35; controls.enableDamping = !locked(); }

// top-down cricket ground: stands, green outfield, inner circle, pitch, four floodlights
const STADIUM = `<svg viewBox="0 0 32 24" aria-hidden="true"><ellipse cx="16" cy="12" rx="15" ry="11" fill="#26302b" stroke="#d6ddd6" stroke-width="1.1"/><ellipse cx="16" cy="12" rx="12" ry="8.4" fill="#2e8f4f"/><ellipse cx="16" cy="12" rx="7.4" ry="5.2" fill="#3aa860"/><rect x="14.5" y="7.6" width="3" height="8.8" rx=".5" fill="#d8bf8a"/><path d="M14.5 9.1h3M14.5 14.9h3" stroke="#fff" stroke-width=".5"/><circle cx="4.6" cy="4.4" r="1.3" fill="#fff4c4"/><circle cx="27.4" cy="4.4" r="1.3" fill="#fff4c4"/><circle cx="4.6" cy="19.6" r="1.3" fill="#fff4c4"/><circle cx="27.4" cy="19.6" r="1.3" fill="#fff4c4"/></svg>`;
function makePin(m) {
  const d = document.createElement("div");
  d.className = "pin"; d.dataset.id = m.id; d.dataset.status = m.status;
  d.style.setProperty("--c", statusColor(m.status));
  d.innerHTML = `<span class="dot">${STADIUM}</span><span class="tag">${m.V?.city || ""} <b>· ${m.a} v ${m.b}</b></span>`;
  d.addEventListener("click", (e) => { e.stopPropagation(); select(m); });
  d.addEventListener("pointerdown", (e) => e.stopPropagation());
  m._pin = d;
  return d;
}
// hide pins on the far side of the globe; only recompute when the camera has moved
function pinLoop() {
  const rad = Math.PI / 180;
  let last = "";
  (function tick() {
    const pov = world.pointOfView();
    const key = `${pov.lat.toFixed(1)},${pov.lng.toFixed(1)},${pov.altitude.toFixed(2)}`;
    if (key !== last) {
      last = key;
      const lim = Math.min(88, 40 + pov.altitude * 30);
      const p1 = pov.lat * rad, s1 = Math.sin(p1), c1 = Math.cos(p1);
      for (const m of [...fixtures, ...grounds]) {
        if (!m._pin || m.lat == null) continue;
        const p2 = m.lat * rad, dist = Math.acos(Math.min(1, s1 * Math.sin(p2) + c1 * Math.cos(p2) * Math.cos((m.lng - pov.lng) * rad))) / rad;
        m._pin.classList.toggle("hidden", dist > lim);
      }
    }
    requestAnimationFrame(tick);
  })();
}

/* ---------- grounds: at least one per major cricket nation ---------- */
const GROUND_NATIONS = { IND: ["IN"], AUS: ["AU"], ENG: ["GB"], NZ: ["NZ"], SA: ["ZA"], PAK: ["PK"], SL: ["LK"], BAN: ["BD"], WI: ["BB", "TT", "JM", "GY", "AG", "LC", "GD", "KN", "VC", "DM"], ZIM: ["ZW"], IRE: ["IE"], UAE: ["AE"], NED: ["NL"], SCO: ["GB"], NEP: ["NP"], NAM: ["NA"], OMA: ["OM"], USA: ["US"], CAN: ["CA"], PNG: ["PG"], HK: ["HK"] };
const SCOTTISH = /^(Edinburgh|Aberdeen|Glasgow|Dundee|Ayr|Forfar|Arbroath|Perth \(Scotland\))$/;
let grounds = [];
function buildGrounds() {
  const total = (v) => Object.values(v.fmt).reduce((n, f) => n + f.p, 0);
  const used = new Set();
  grounds = [];
  for (const [team, ccs] of Object.entries(GROUND_NATIONS)) {
    const list = Object.values(venues).filter((v) => ccs.includes(v.cc) && v.lat != null && !used.has(v.id) && (team === "SCO" ? SCOTTISH.test(v.city || "") : team === "ENG" ? !SCOTTISH.test(v.city || "") && !/Belfast|Bready|Stormont/.test(v.city || v.name) : true))
      .sort((a, b) => total(b) - total(a)).slice(0, TEAMS[team]?.major === false ? 1 : 2);
    for (const v of list) { used.add(v.id); grounds.push({ id: "g:" + v.id, ground: true, team, V: v, lat: v.lat, lng: v.lon, n: total(v) }); }
  }
}
function makeGroundPin(g) {
  const d = document.createElement("div");
  d.className = "pin ground"; d.dataset.id = g.id;
  d.innerHTML = `<span class="dot">${STADIUM}</span><span class="tag">${g.V.name} <b>· ${TEAMS[g.team]?.name || g.team} · ${g.n} internationals</b></span>`;
  d.title = `${g.V.name}, ${g.V.city || ""}: research a match here`;
  d.addEventListener("click", (e) => { e.stopPropagation(); openFinder(TEAMS[g.team]?.name || "", g.V.id); });
  d.addEventListener("pointerdown", (e) => e.stopPropagation());
  g._pin = d;
  return d;
}

/* ---------- fixtures rail ---------- */
function renderData() {
  const ms = visible().filter((m) => m.lat != null);
  const fixtureVenues = new Set(ms.map((m) => m.venue));
  if (world) world.htmlElementsData([...grounds.filter((g) => !fixtureVenues.has(g.V.id)), ...ms]).ringsData(ms.filter((m) => m.status === "live"));
  const order = { live: 0, soon: 1, upcoming: 2, done: 3 };
  $("#cards").innerHTML = visible().slice().sort((a, b) => order[a.status] - order[b.status] || new Date(a.start) - new Date(b.start)).map((m) => `
    <button class="fx${selected?.id === m.id ? " sel" : ""}" data-id="${m.id}" aria-label="${TEAMS[m.a]?.name} v ${TEAMS[m.b]?.name}, ${m.fmt}, ${m.statusLabel}">
      <div class="row"><span class="status ${m.status}">${m.statusLabel}</span><span class="fmt">${m.fmt}</span></div>
      <div class="teams"><span style="color:${TEAMS[m.a]?.c}">${m.a}</span><i>v</i><span style="color:${TEAMS[m.b]?.c}">${m.b}</span></div>
      <div class="meta">${m.V ? [m.V.name, m.V.city].filter(Boolean).join(", ") : "Venue TBC"}</div>
    </button>`).join("");
  document.querySelectorAll(".pin").forEach((p) => p.classList.toggle("sel", p.dataset.id === selected?.id));
}
$("#cards").addEventListener("click", (e) => { const b = e.target.closest(".fx"); if (b) select(fixtures.find((m) => m.id === b.dataset.id)); });
// prefetch the dossier data on hover so the click feels instant
$("#cards").addEventListener("pointerover", (e) => { const b = e.target.closest(".fx"); if (!b) return; const m = fixtures.find((x) => x.id === b.dataset.id); if (m) { getTeam(m.a); getTeam(m.b); getPair(m.a, m.b); } });

/* ---------- select a match ---------- */
function select(m, { silent = false, autoNews = false } = {}) {
  if (!m) return;
  selected = m; hideHint();
  if (m.a !== "IND" && m.b !== "IND") { view = "world"; filterIndia = false; setPressed("vWorld", true); setPressed("vIndia", false); }
  if (world && m.lat != null) {
    controls.autoRotate = false;
    const alt = m.V?.cc === "IN" ? 0.6 : 0.85, narrow = innerWidth < 720;
    world.pointOfView({ lat: m.lat - (narrow ? 22 * alt : 3), lng: m.lng - (narrow ? 0 : 26 * alt), altitude: alt }, reduceMotion ? 0 : 1600);
  }
  refreshPolys(); renderData();
  openDossier({ fx: m, V: m.V, meta, venues, TEAMS, onClose: clearSelection, autoNews });
  if (!silent) trumpet();
  history.replaceState(null, "", m.custom ? `#a=${m.a}&b=${m.b}&f=${m.fmt}${m.venue ? `&v=${m.venue}` : ""}${m.date ? `&d=${m.date}` : ""}` : `#fx=${m.id}`);
}
function clearSelection() {
  selected = null; closeDossier();
  history.replaceState(null, "", location.pathname);
  if (world) { if (locked()) goIndia(1200); else { spin(true); world.pointOfView({ altitude: 2.2 }, reduceMotion ? 0 : 1200); } }
  refreshPolys(); renderData();
}

/* ---------- views & filters ---------- */
function setPressed(id, v) { $("#" + id).setAttribute("aria-pressed", String(v)); }
function goIndia(ms = 1800) { view = "india"; filterIndia = true; refreshPolys(); renderData(); controls.autoRotate = false; controls.enableDamping = false; setPressed("vIndia", true); setPressed("vWorld", false); world.pointOfView({ lat: 21, lng: 79, altitude: 0.85 }, reduceMotion ? 0 : ms); }
function goWorld() { view = "world"; filterIndia = false; refreshPolys(); renderData(); setPressed("vWorld", true); setPressed("vIndia", false); world.pointOfView({ lat: 12, lng: 60, altitude: 2.4 }, reduceMotion ? 0 : 1500); }
const deselect = () => { if (selected) { selected = null; closeDossier(); refreshPolys(); renderData(); } };
$("#vIndia").onclick = () => { deselect(); goIndia(); };
$("#vWorld").onclick = () => { deselect(); goWorld(); spin(true); };
addEventListener("keydown", (e) => { if (e.key === "Escape" && selected && !$("#finder").open) clearSelection(); });
let hintGone = false;
function hideHint() { if (hintGone) return; hintGone = true; $("#hint").style.opacity = 0; }

/* ---------- sound: first half of the IPL trumpet, only when a match is selected ---------- */
let soundOn = true, ac = null, trumpetBuf = null, clipData = null, clipBuf = null;
try { soundOn = localStorage.getItem("tmv-sound") !== "off"; clipData = localStorage.getItem("tmv-clip"); } catch {}
setPressed("sound", soundOn);
if (clipData) setPressed("clipBtn", true);
const audio = () => { ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume(); return ac; };
async function decode(b64OrUrl) {
  if (b64OrUrl.startsWith("data:")) { const bin = atob(b64OrUrl.split(",")[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return audio().decodeAudioData(u.buffer); }
  return audio().decodeAudioData(await (await fetch(b64OrUrl)).arrayBuffer());
}
async function trumpet() {
  if (!soundOn) return;
  try {
    const ctx = audio();
    const buf = clipData ? (clipBuf ||= await decode(clipData)) : (trumpetBuf ||= await decode("audio/trumpet.mp3"));
    const s = ctx.createBufferSource(), g = ctx.createGain(), t = ctx.currentTime, d = Math.min(buf.duration, 3.3);
    s.buffer = buf; g.gain.setValueAtTime(0.9, t); g.gain.setValueAtTime(0.9, t + d - 0.25); g.gain.linearRampToValueAtTime(0, t + d);
    s.connect(g).connect(ctx.destination); s.start(t); s.stop(t + d);
  } catch {}
}
$("#sound").onclick = () => { soundOn = !soundOn; setPressed("sound", soundOn); try { localStorage.setItem("tmv-sound", soundOn ? "on" : "off"); } catch {} };
function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = `<span></span>${action ? `<button>${action.label}</button>` : ""}`;
  t.firstChild.textContent = msg;
  if (action) t.querySelector("button").onclick = action.fn;
  t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4000);
}
$("#clipBtn").onclick = () => {
  if (clipData) toast("Your own clip plays when you pick a match.", { label: "Use the trumpet", fn: () => { clipData = clipBuf = null; try { localStorage.removeItem("tmv-clip"); } catch {} setPressed("clipBtn", false); toast("Back to the IPL trumpet."); } });
  else $("#clipFile").click();
};
$("#clipFile").onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 3e6) return toast("That file is over 3 MB. Trim it to a 2–3 second clip and try again.");
  const r = new FileReader();
  r.onload = async () => {
    try { clipBuf = await decode(r.result); clipData = r.result; } catch { return toast("Couldn't play that file. Try an MP3, WAV or M4A."); }
    try { localStorage.setItem("tmv-clip", clipData); } catch {}
    setPressed("clipBtn", true); toast("Clip loaded. It plays when you pick a match.");
  };
  r.readAsDataURL(f); e.target.value = "";
};

/* ---------- teams outside the major 13 get a calm colour from a fixed palette ---------- */
const ASSOC_COLOURS = ["#8fb8de", "#c6a4dc", "#e8b27c", "#7fcdbb", "#e59a9a", "#b5c18e", "#d6b8e8", "#9ad1d4"];
function addTeams(list) {
  for (const [code, v] of Object.entries(list)) {
    if (TEAMS[code]) Object.assign(TEAMS[code], { major: true, n: v.n });
    else TEAMS[code] = { name: v.name, n: v.n, major: false, c: ASSOC_COLOURS[[...code].reduce((h, ch) => h + ch.charCodeAt(0), 0) % ASSOC_COLOURS.length] };
  }
}

function openCustom({ a, b, fmt, venue, date }) {
  const V = venue ? venues[venue] : null;
  const m = withStatus({ id: "custom", custom: true, a, b, fmt, venue, date, series: null, start: date ? `${date}T09:30:00Z` : new Date().toISOString(), tz: null });
  m.statusLabel = date ? new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""; m.status = "upcoming";
  fixtures = fixtures.filter((f) => f.id !== "custom");
  if (V) fixtures.push(m);
  select(m);
}

/* ---------- research mode: upcoming (globe + fixtures) or past (archive) ---------- */
let mode = null;
function showChooser() {
  const ch = $("#chooser");
  ch.hidden = false; document.body.classList.add("choosing"); requestAnimationFrame(() => ch.classList.add("on"));
  controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.5; // the globe idles behind the question
  ch.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => (b.dataset.mode === "newsletter" ? quickNewsletter() : setMode(b.dataset.mode))));
  ch.querySelector("[data-mode]").focus();
}
function hideChooser() { const ch = $("#chooser"); ch.classList.remove("on"); document.body.classList.remove("choosing"); setTimeout(() => (ch.hidden = true), 450); }
// Every path off the start screen begins the same way: the globe revolves once, quickly, then hands over.
function revolveThen(fn) {
  if (reduceMotion || !world) return fn();
  controls.autoRotate = true; controls.autoRotateSpeed = 9;
  world.pointOfView({ lat: 18, lng: 70, altitude: 2.6 }, 1000);
  setTimeout(() => { controls.autoRotateSpeed = 0.4; fn(); }, 1300);
}
function setMode(next, { fromHash = false } = {}) {
  if (mode === next && !fromHash) return;
  mode = next;
  hideChooser();
  setPressed("mUp", next === "upcoming"); setPressed("mPast", next === "past");
  document.body.classList.toggle("mode-past", next === "past");
  if (next === "past") {
    deselect();
    revolveThen(openArchive); // the archive slides in once the globe has turned
  } else {
    closeArchive();
    // revolve, settle on India, then open the linked match or India's next fixture
    revolveThen(() => {
      goIndia(1800);
      setTimeout(() => { if (!openFromHash()) { const next = nextIndiaFixture(); if (next) select(next, { silent: true }); } }, reduceMotion ? 100 : 2000);
    });
  }
}
// The one-click path: India's next match -> its dossier on the Write tab -> newsletter written and sent to Telegram.
function nextToWrite() {
  const ahead = fixtures.filter((f) => (f.a === "IND" || f.b === "IND") && (f.status === "soon" || f.status === "upcoming") && !f.custom && !f.sample).sort((x, y) => new Date(x.start) - new Date(y.start));
  return ahead[0] || nextIndiaFixture();
}
function quickNewsletter() {
  const m = nextToWrite();
  if (!m) return toast("No live India fixture right now. Use Search to pick a match.");
  hideChooser(); closeArchive();
  mode = "upcoming"; setPressed("mUp", true); setPressed("mPast", false); document.body.classList.remove("mode-past");
  deselect();
  revolveThen(() => { goIndia(1500); setTimeout(() => select(m, { autoNews: true }), reduceMotion ? 0 : 1700); });
}
function labelCTA() {
  const m = nextToWrite();
  const when = m && new Date(m.start).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const label = m ? `${TEAMS[m.a]?.name || m.a} v ${TEAMS[m.b]?.name || m.b} · ${m.fmt} · ${when}` : "No live India fixture · search a match";
  $("#ctaMatch").textContent = label;
  const ch = $("#chMatch"); if (ch) ch.textContent = m ? `${label}${m.V ? ` · ${m.V.name}` : ""}` : label;
}
$("#ctaNews").onclick = quickNewsletter;
$("#histBtn").onclick = () => import("./history.js").then((m) => m.openHistory());
$("#brandHome").onclick = () => { if ($("#finder").open) $("#finder").close(); deselect(); closeArchive(); mode = null; showChooser(); };
$("#mUp").onclick = () => setMode("upcoming");
$("#mPast").onclick = () => setMode("past");

/* ---------- deep links ---------- */
function nextIndiaFixture() {
  const order = { live: 0, soon: 1, upcoming: 2 };
  return fixtures.filter((f) => (f.a === "IND" || f.b === "IND") && f.status in order && !f.custom && !f.sample).sort((x, y) => order[x.status] - order[y.status] || new Date(x.start) - new Date(y.start))[0];
}
// Look a match up by its CricketData ID (from the search box or a shared link) and open it.
async function openMatchId(id) {
  const known = fixtures.find((f) => f.id === id);
  if (known) return select(known), true;
  try {
    const r = await fetch(`api/match?id=${encodeURIComponent(id)}`);
    const j = await r.json();
    if (!r.ok || !j.fixture) throw new Error(j.error || "Not found");
    const m = withStatus(j.fixture);
    fixtures = [...fixtures.filter((f) => f.id !== m.id), m];
    renderData(); select(m);
    return true;
  } catch (e) { toast(`Couldn't find that match: ${e.message}`); return false; }
}
function openFromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("fx")) {
    const m = fixtures.find((f) => f.id === p.get("fx"));
    if (m) return select(m, { silent: true }), true;
    if (/^[0-9a-f-]{36}$/i.test(p.get("fx"))) { openMatchId(p.get("fx")); return true; }
  }
  if (p.get("a") && p.get("b") && TEAMS[p.get("a")] && TEAMS[p.get("b")]) { openCustom({ a: p.get("a"), b: p.get("b"), fmt: p.get("f") || "T20I", venue: p.get("v"), date: p.get("d") }); return true; }
  return false;
}

/* ---------- boot: intro runs while data and the globe load ---------- */
const USER_NAME = "Arjun";
const ready = Promise.all([getMeta(), getVenues(), getFixtures()]).then(([m, v, f]) => {
  meta = m; venues = v;
  fixtures = f.fixtures.map(withStatus);
  // every match in a series shares one squad request (the first match's ID), so the CDN serves the rest
  const firstOfSeries = {};
  for (const x of fixtures) if (x.sid && !firstOfSeries[x.sid]) firstOfSeries[x.sid] = x.id;
  for (const x of fixtures) if (x.sid) x.squadId = firstOfSeries[x.sid];
  const src = $("#fxSource");
  src.textContent = f.live ? ({ backup: "Live fixtures · via Google Search", cricbuzz: "Live fixtures · via Cricbuzz" }[f.source] || "Live fixtures") : `Sample fixtures · data to ${new Date(meta.built).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  src.classList.toggle("live", f.live);
  addTeams(meta.teams);
  labelCTA();
  // warm the cache for India's next match while the intro plays, so its dossier opens instantly
  { const n = nextToWrite(); if (n) { getTeam(n.a); getTeam(n.b); getPair(n.a, n.b); } }
  buildGrounds();
  initArchive({ teams: () => TEAMS, venues: () => venues, onClose: () => setMode("upcoming") });
  initFinder({ teams: () => TEAMS, fixtures: () => fixtures, venues: () => venues, openFixture: (f) => select(f), openCustom, openMatchId });
});
const globeReady = new Promise((res) => {
  const go = () => { initGlobe(); world.pointOfView({ lat: 8, lng: -30, altitude: 7.5 }); res(); };
  if (window.Globe) go(); else document.querySelector('script[src*="globe.gl"]').addEventListener("load", go);
});
Promise.all([ready, globeReady]).then(() => { renderData(); });
setInterval(() => { if (!venues) return; fixtures = fixtures.map((f) => ({ ...withStatus(f), _pin: f._pin })); renderData(); }, 60000);

{
  let short = false; try { short = sessionStorage.getItem("tmv-intro") === "1"; sessionStorage.setItem("tmv-intro", "1"); } catch {}
  const hr = +new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date());
  playIntro({
    ready: Promise.all([ready, globeReady]),
    name: USER_NAME,
    greeting: `Good ${hr >= 5 && hr < 12 ? "morning" : hr >= 12 && hr < 17 ? "afternoon" : "evening"}`,
    short, reduceMotion, getAudio: audio,
    onDone: () => {
      world.pointOfView({ lat: 16, lng: 62, altitude: 2.4 }, reduceMotion ? 0 : 1500);
      setTimeout(() => document.body.classList.remove("pre"), reduceMotion ? 0 : 600);
      setTimeout(() => {
        controls.maxDistance = 650;
        showChooser();
      }, reduceMotion ? 50 : 900);
    },
  });
}
