// "Compare players" (in the AI tab): pick any two current players from either side and Gemini Flash explains who
// has the edge, using only their real records (career and last-12-month, by format) and any meetings between them.
// House joke: it opens on Suresh Raina v Virat Kohli, and whenever Raina is picked his numbers are ∞ (no Gemini call),
// with a switch to the real comparison.
import { getJSON } from "./data.js";
import { buildContext, md } from "./brief.js";
import { RAINA, KOHLI } from "./players.js";

const FMTS = ["T20I", "ODI", "Test"];
const ROLE = { BAT: "bat", WK: "wk", AR: "all-r", BOWL: "bowl" };

// current players only: in this match's squads, or capped in the last 18 months
async function loadPlayers(S, d) {
  const built = new Date((S.meta?.built || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  const cutoff = new Date(Date.UTC(built.getUTCFullYear(), built.getUTCMonth() - 18, built.getUTCDate())).toISOString().slice(0, 10);
  const inSquad = new Set([...(d.squadA || []), ...(d.squadB || [])].map((p) => p.id));
  const out = {};
  for (const t of [S.fx.a, S.fx.b]) {
    const j = await getJSON(`data/players/${t}.json`).catch(() => ({ players: [] }));
    out[t] = j.players.filter((p) => p.id === RAINA || p.id === KOHLI || inSquad.has(p.id) || (p.last || "") >= cutoff).map((p) => ({ ...p, t, sq: inSquad.has(p.id) }));
  }
  return out;
}

// the numbers Gemini sees for one player
function summary(p) {
  const f = {};
  for (const k of FMTS) {
    const x = p.f[k];
    if (!x) continue;
    f[k] = {
      matches: x.m, span: `${x.from?.slice(0, 4)}-${x.to?.slice(0, 4)}`,
      batting: x.bat ? { innings: x.bat.inn, runs: x.bat.r, average: x.bat.avg, strikeRate: x.bat.sr, hundreds: x.bat.c100, fifties: x.bat.c50, highest: x.bat.hs } : null,
      bowling: x.bowl?.w || x.bowl?.b ? { wickets: x.bowl.w, average: x.bowl.avg, economy: x.bowl.econ, strikeRate: x.bowl.sr, best: x.bowl.best } : null,
    };
  }
  return { name: p.n, team: p.t, role: p.role, lastInternational: p.last, byFormat: f };
}

export async function comparePanel(body, S, d, h) {
  const e = h.esc, A = S.fx.a, B = S.fx.b;
  S.cmp ||= { a: "", b: "" };
  if (!S.cmpPL) {
    body.innerHTML = `<div class="sk" style="height:180px"></div>`;
    S.cmpPL = await loadPlayers(S, d);
    if (S.tab !== "brief" || S.aiMode !== "compare") return;
  }
  const all = [...S.cmpPL[A], ...S.cmpPL[B]], find = (id) => all.find((p) => p.id === id);
  if (!S.cmp.picked && find(RAINA) && find(KOHLI)) { S.cmp.a = RAINA; S.cmp.b = KOHLI; S.cmp.picked = true; }
  const total = (p) => FMTS.reduce((n, f) => n + (p.f[f]?.m || 0), 0);
  const options = (sel) => `<option value=""${sel ? "" : " selected"}>Select a player</option>` + [A, B].map((t) =>
    `<optgroup label="${e(h.nm(t))}">${S.cmpPL[t].slice().sort((x, y) => y.sq - x.sq || total(y) - total(x)).map((p) => `<option value="${e(p.id)}"${p.id === sel ? " selected" : ""}>${e(p.n)} (${ROLE[p.role] || ""})</option>`).join("")}</optgroup>`).join("");
  const L = find(S.cmp.a), R = find(S.cmp.b), out = S.cmp.out;
  body.innerHTML = `<section class="sec">
    <div class="sec-h"><h3>Compare players</h3><span class="aside">their real records, explained by Gemini Flash</span></div>
    <div class="cmp-pick">
      <select id="cmpA" aria-label="First player">${options(S.cmp.a)}</select>
      <span class="cmp-v">v</span>
      <select id="cmpB" aria-label="Second player">${options(S.cmp.b)}</select>
    </div>
    <button class="cta" id="cmpGo" ${L && R && L.id !== R.id && !S.cmp.busy ? "" : "disabled"}><span>${S.cmp.busy ? "Comparing…" : L && R ? `Compare ${e(L.n)} v ${e(R.n)}` : "Select two players to compare"}</span><span aria-hidden="true">→</span></button>
    ${L && R && (L.id === RAINA || R.id === RAINA) ? `<p class="note">House joke is on: with Suresh Raina picked, his numbers are ∞. <button class="linkbtn" id="cmpReal">${S.cmp.real ? "Back to ∞" : "Compare the real numbers instead"}</button></p>` : ""}
    <div id="cmpOut">${out?.joke ? jokeCard(L, R, S.fmt, e) : out ? (out.error ? `<div class="empty">${e(out.error)}</div>` : `<article class="card brief newsletter"><div class="brief-bar"><span class="src-pill ai">Written by ${e(out.model || "Gemini Flash")}</span></div>${md(out.text, e)}${out.sources?.length ? `<p class="note">Sources: ${out.sources.map((s) => `<a href="${e(s.url)}" target="_blank" rel="noopener">${e(s.title || s.url)}</a>`).join(" · ")}</p>` : ""}</article>`) : ""}</div>
  </section>`;
  const onPick = () => { S.cmp.a = body.querySelector("#cmpA").value; S.cmp.b = body.querySelector("#cmpB").value; S.cmp.out = null; comparePanel(body, S, d, h); };
  body.querySelector("#cmpA").onchange = onPick;
  body.querySelector("#cmpB").onchange = onPick;
  body.querySelector("#cmpReal")?.addEventListener("click", () => { S.cmp.real = !S.cmp.real; S.cmp.out = null; comparePanel(body, S, d, h); });
  body.querySelector("#cmpGo").onclick = async () => {
    if (!L || !R || S.cmp.busy) return;
    if ((L.id === RAINA || R.id === RAINA) && !S.cmp.real) { S.cmp.out = { joke: true }; return comparePanel(body, S, d, h); }
    const token = S.token;
    S.cmp.busy = true; comparePanel(body, S, d, h);
    // meetings between the two in the ball-by-ball records, when the pair file has them
    const meet = [];
    for (const f of FMTS) for (const [bat, bowl, balls, runs, outs] of S.P?.matchups?.[f] || []) {
      if ((bat === L.id && bowl === R.id) || (bat === R.id && bowl === L.id)) meet.push({ format: f, batter: S.P.names[bat], bowler: S.P.names[bowl], balls, runs, dismissals: outs });
    }
    const context = { ...buildContext(S, d, h), compare: { players: [summary(L), summary(R)], meetings: meet } };
    const question = `Compare ${L.n} and ${R.n}, focusing on ${S.fmt}s but noting other formats where useful. Who has the edge and why? Use only the numbers in DATA.compare (and DATA.compare.meetings if they have faced each other). Keep it under 180 words, with short bullets for each player, and end with a one-line verdict.`;
    try {
      const r = await fetch("api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context, question }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.answer) throw new Error(j.error || `HTTP ${r.status}`);
      S.cmp.out = { text: j.answer, sources: j.sources || [], model: j.model };
    } catch (err) {
      S.cmp.out = { error: `Couldn't compare them: ${err.message || err}` };
    }
    S.cmp.busy = false;
    if (S.token === token && S.tab === "brief" && S.aiMode === "compare") comparePanel(body, S, d, h);
  };
}

// The joke verdict: Raina ∞ on every line, the other player's real figures beside him.
function jokeCard(L, R, fmt, e) {
  const rainaLeft = L.id === RAINA, other = rainaLeft ? R : L, x = other.f[fmt] || {};
  const lines = [["Matches", x.m], ["Runs", x.bat?.r], ["Batting average", x.bat?.avg], ["Strike rate", x.bat?.sr], ["Hundreds", x.bat?.c100], ["Wickets", x.bowl?.w]];
  return `<article class="card brief newsletter"><div class="brief-bar"><span class="src-pill ai">House verdict</span></div>
    <h3>Suresh Raina v ${e(other.n)}: no contest</h3>
    <table class="cmp-t"><thead><tr><th class="cv a">Suresh Raina</th><th></th><th class="cv b">${e(other.n)} <small class="muted">(real, ${fmt})</small></th></tr></thead><tbody>
    ${lines.map(([k, v]) => `<tr><td class="cv a win">∞</td><th scope="row">${k}</th><td class="cv b">${v ?? "—"}</td></tr>`).join("")}
    </tbody></table>
    <p><b>Verdict:</b> Suresh Raina. Mr IPL. Obviously.</p>
    <p class="note">This is the house joke: Raina's column is ∞, not a statistic. Use "Compare the real numbers instead" for the genuine analysis.</p></article>`;
}
