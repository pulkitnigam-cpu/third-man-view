// Writes public/data/countries.json: shapes for every cricket nation on the globe, from Natural Earth 1:50m (world-atlas).
// India and its neighbours use Natural Earth's India point-of-view boundaries (official Indian map: all of Jammu & Kashmir
// and Ladakh, including Gilgit-Baltistan and Aksai Chin). Download once:
//   curl -o .cache/ne/ne_10m_admin_0_countries_ind.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson
// West Indies is a team of many countries; each island keeps its own shape and the app groups them by team.
import fs from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const world = require("world-atlas/countries-50m.json");
const coarse = require("world-atlas/countries-110m.json");
// huge countries with long coastlines come from the lighter 1:110m map
const COARSE = new Set(["United States of America", "Canada"]);
const INDIA_POV = new Set(["India", "Pakistan", "Afghanistan", "Nepal", "Bangladesh", "Sri Lanka"]);
const pov = JSON.parse(fs.readFileSync(".cache/ne/ne_10m_admin_0_countries_ind.geojson", "utf8"));

// Douglas-Peucker, so the 1:10m outlines stay light
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, max = 0;
    const [x1, y1] = ring[a], [x2, y2] = ring[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12;
    // closed rings start and end on the same point: measure distance to that point instead of to a line
    const degenerate = Math.hypot(dx, dy) < 1e-9;
    for (let i = a + 1; i < b; i++) { const d = degenerate ? Math.hypot(ring[i][0] - x1, ring[i][1] - y1) : Math.abs(dy * ring[i][0] - dx * ring[i][1] + x2 * y1 - y2 * x1) / len; if (d > max) { max = d; idx = i; } }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}
const simplifyGeom = (g, tol) => ({ type: g.type, coordinates: g.type === "Polygon" ? g.coordinates.map((r) => simplify(r, tol)) : g.coordinates.map((p) => p.map((r) => simplify(r, tol))) });
const povFeatures = pov.features.filter((f) => INDIA_POV.has(f.properties.NAME) || INDIA_POV.has(f.properties.ADMIN))
  .map((f) => ({ properties: { name: INDIA_POV.has(f.properties.NAME) ? f.properties.NAME : f.properties.ADMIN }, geometry: simplifyGeom(f.geometry, 0.02) }));
const NAMES = [
  "India", "Australia", "United Kingdom", "New Zealand", "South Africa", "Pakistan", "Sri Lanka", "Bangladesh", "Afghanistan",
  "Zimbabwe", "Ireland", "United Arab Emirates",
  // the most active associate nations (Scotland sits inside the UK shape)
  "Netherlands", "Nepal", "Namibia", "Oman", "Papua New Guinea", "Hong Kong", "United States of America", "Canada",
  // West Indies
  "Jamaica", "Trinidad and Tobago", "Barbados", "Guyana", "Antigua and Barb.", "Saint Lucia", "Grenada", "St. Vin. and Gren.", "Dominica", "St. Kitts and Nevis",
];
const round = (c) => (typeof c[0] === "number" ? [+c[0].toFixed(2), +c[1].toFixed(2)] : c.map(round));
const dedupe = (ring) => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
const clean = (g) => {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly) => poly.map((r) => dedupe(round(r))).filter((r) => r.length >= 4));
  return { type: "MultiPolygon", coordinates: polys.filter((p) => p.length) };
};
const fc = feature(world, world.objects.countries), fcc = feature(coarse, coarse.objects.countries);
const features = [...fc.features.filter((f) => !COARSE.has(f.properties.name) && !INDIA_POV.has(f.properties.name)), ...fcc.features.filter((f) => COARSE.has(f.properties.name)), ...povFeatures].filter((f) => NAMES.includes(f.properties.name)).map((f) => ({ type: "Feature", properties: { name: f.properties.name }, geometry: clean(f.geometry) }));
const missing = NAMES.filter((n) => !features.some((f) => f.properties.name === n));
if (missing.length) throw new Error("missing " + missing.join(", "));
fs.writeFileSync("public/data/countries.json", JSON.stringify({ type: "FeatureCollection", features }));
console.log(`${features.length} countries, ${fs.statSync("public/data/countries.json").size} bytes`);
