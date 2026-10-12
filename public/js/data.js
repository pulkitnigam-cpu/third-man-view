// Fetch helpers. Static JSON is cached in memory; in-flight requests are shared so hover-prefetch and click don't double-load.
const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`)))).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}
export const getMeta = () => getJSON("data/meta.json");
export const getVenues = () => getJSON("data/venues.json");
export const getTeam = (code) => getJSON(`data/teams/${code}.json`).catch(() => null);
export const pairKey = (a, b) => [a, b].sort().join("-");
export const getPair = (a, b) => getJSON(`data/pairs/${pairKey(a, b)}.json`).catch(() => null);

// Live fixtures from /api/fixtures when deployed with a CricketData.org key; otherwise the bundled sample.
export async function getFixtures() {
  try {
    const r = await fetch("api/fixtures", { headers: { accept: "application/json" } });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
      const j = await r.json();
      if (j?.fixtures?.length) return { live: true, fixtures: j.fixtures, source: j.source };
    }
  } catch {}
  const j = await getJSON("data/fixtures.json");
  return { live: false, fixtures: j.fixtures.map((f) => ({ ...f, sample: true })) };
}

// Match-day forecast (Open-Meteo, no key). Only available up to 16 days ahead.
export async function getForecast(lat, lon, startISO, fmt) {
  if (lat == null) return null;
  const start = new Date(startISO), now = new Date();
  const days = (start - now) / 864e5;
  if (days > 15.5 || days < -5) return { unavailable: days > 0 ? "too-far" : "past" };
  const dur = fmt === "Test" ? 5 * 24 : fmt === "ODI" ? 8 : 4;
  const end = new Date(start.getTime() + dur * 36e5);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,cloud_cover,wind_speed_10m&timezone=UTC&start_date=${ymd(new Date(start.getTime() - 864e5))}&end_date=${ymd(new Date(end.getTime() + 864e5))}`;
  try {
    const j = await getJSON(u);
    const H = j.hourly, rows = [];
    H.time.forEach((t, i) => {
      const at = new Date(t + "Z");
      if (at >= start && at <= end) rows.push({ at, t: H.temperature_2m[i], rh: H.relative_humidity_2m[i], dew: H.dew_point_2m[i], pp: H.precipitation_probability[i], pr: H.precipitation[i], cl: H.cloud_cover[i], ws: H.wind_speed_10m[i] });
    });
    if (!rows.length) return { unavailable: "no-data" };
    const avg = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0) / rows.length;
    const max = (k) => Math.max(...rows.map((r) => r[k] ?? 0));
    const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
    const last = rows.slice(-Math.ceil(rows.length / 2)); // second half of the game, when dew matters
    const lateDew = last.reduce((s, r) => s + (r.dew ?? 0), 0) / last.length, lateRH = last.reduce((s, r) => s + (r.rh ?? 0), 0) / last.length;
    return {
      rows, tmax: max("t"), rh: avg("rh"), dew: avg("dew"), lateDew, lateRH, rainProb: max("pp"), rain: sum("pr"), cloud: avg("cl"), wind: max("ws"),
      // same shape as historical wx so the same condition tests apply: [tmax, rain, rh, cloud, dew, wind]
      wx: [max("t"), sum("pr"), avg("rh"), avg("cl"), fmt === "Test" ? avg("dew") : lateDew, max("ws")],
    };
  } catch {
    return { unavailable: "error" };
  }
}
