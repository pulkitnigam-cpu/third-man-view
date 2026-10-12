# Third Man View · Match Radar

Pre-match and post-match cricket research for Arjun's *Third Man View* newsletter. After the intro, choose **Upcoming matches** (globe, fixtures, pre-match dossier and brief) or **Past matches** (archive of every men's international since 2002, with scorecards, match stories and AI match reports). **Find any match** (or press `/`) searches all 112 teams and 901 pairings.

Upcoming-match dossier tabs:

| Tab | What's in it | Source |
|---|---|---|
| Overview | Win probability (head-to-head + venue-type record + recent form, explained), key numbers, auto-generated insights | computed |
| Head-to-head | Record by format and period; splits by home/away/neutral, who batted first, toss, weather (rain, humid, overcast, dew, hot, cool), surface (high/par/low scoring); every result; rivalry leaders | Cricsheet + Open-Meteo archive |
| Venue & conditions | Ground record, bat-first vs chase, toss habits, phase run rates, three ranked venue trends, live match-day forecast with dew/rain/swing flags, each team's W–L in every condition | Cricsheet + Open-Meteo |
| Squads & form | Probable squads (last 8 games), predicted XI, last-5 innings bars, career v last 12 months, phase splits, record v this opponent | Cricsheet |
| Players & matchups | Pick any two players (dropdowns) who have played for either side since 2018: key numbers for their roles, whether they have faced each other, and batting/bowling depth, splits, phases and last 10 innings behind "More" toggles | Cricsheet ball-by-ball |
| AI desk | Pre-match brief (structured), a full newsletter edition in Arjun's voice (Markdown, copy-ready), and Ask Third Man (chat that answers from the dossier data, with Google Search for news). Pitch report and team news come from Search grounding | Gemini Flash (`gemini-3.8-flash`) |

### Past matches

Filter by team, opponent, format, year and result. Each match opens a review: **Scorecard** (batting with dismissals, bowling), **Story** (standouts, phase by phase, toss, conditions, rivalry before the match) and **✦ Match report** (Gemini Flash writes a newsletter report; ask follow-up questions). Gemini can also review the whole filtered period. Endpoint: `POST /api/review` with `mode: "report" | "period" | "ask"`.

### Predicted XI rubric

Each squad player scores 0–100: selection continuity 30 (games of the last 5, played the latest), current form 30 (last 5 innings or spells against a format benchmark), proven record 20 (career in the format, shrunk for small samples), record v opponent 10, freshness 10 (days since last played). The XI is built from the top scores with balance rules: one designated keeper, at least five bowling options, 3–5 specialist bowlers (4–5 in Tests), at most seven specialist batters; batting order follows usual position. See `predictXI` in `public/js/stats.js`.

### Player names

Cricsheet lists players by initials. The build expands them from Cricsheet's own register (`names.csv`) and, for players active since 2018 that the register can't resolve, asks Gemini Flash once (cached in `.cache/fullnames.json`; kept only if the surname matches).

## Run locally

```bash
npm install
npm run data   # rebuilds public/data from the Cricsheet files in .cache/raw (see below)
npm run dev    # http://localhost:5173 — serves public/ and runs api/*.js
```

Put keys in `.env` (see `.env.example`). Optional `OPENROUTER_API_KEY` is a backup route to the same Gemini Flash model (`google/` models only, pinned to Google's servers): it is used only when the direct Gemini key is missing, rate-limited or failing, including web searches once the direct Google Search allowance runs out. Without either Gemini key the brief falls back to a data-only draft; without `CRICAPI_KEY` the rail shows sample fixtures.

### Live data from CricketData.org

| Endpoint | What it does | Cost (free plan: 100 hits/day) |
|---|---|---|
| `GET /api/fixtures` | India's senior series (series search → series_info) plus other internationals on now (currentMatches) | ~4–6 hits, CDN-cached 3 h |
| `GET /api/match?id=` | One match by its CricketData ID (search box or `#fx=<id>` link) | 1 hit, cached 3 h |
| `GET /api/squad?id=` | Announced squad with roles and bowling styles; the predicted XI only picks announced players and keeps at least one spinner and two pacers | ~10 hits, cached 12 h; every match in a series uses the same URL |

The API's `matchType` is unreliable (T20Is arrive as "odi"), so the format is read from the match name.

**Cricbuzz via RapidAPI (free BASIC plan, 200 requests/month), `api/_cricbuzz.js`:** the first choice for squads, because Cricbuzz publishes the exact squad per format ("India T20I Squad"), about 4 requests per series, cached 24 h. Also the second source for fixtures (India's schedule in one request). Set `RAPIDAPI_KEY`.

Two more endpoints close the gaps the archive leaves:

| Endpoint | What it does | Cost |
|---|---|---|
| `GET /api/recent?a=&b=&fmt=&since=` | Matches played since the Cricsheet archive's last update: both sides' Cricbuzz results plus scorecards, merged in the browser into each player's last five innings and spells, team form, the win model and head-to-head | 1 request per team (6 h cache) + 1 per new scorecard (30-day cache) |
| `GET /api/pitch?a=&b=&ca=&cb=&fmt=&start=&venue=&city=` | Pitch report: Cricbuzz pitch note (when published) + Cricbuzz series news (previews, pitch and dew stories) + Google Search when the daily allowance remains; plain Gemini writes it up from those notes only, with quotes and sources, separating this match from the series pattern | ~4 Cricbuzz requests, cached 6 h |

Announced roles from the squad ("WK-Batsman", "Batting Allrounder") replace roles inferred from the numbers.

| Data | Order of sources |
|---|---|
| Fixtures | CricketData.org → Cricbuzz → Gemini + Google Search → sample fixtures |
| Squads | Cricbuzz (format squad) → CricketData.org (tour squad) → Gemini + Google Search → probable squads from Cricsheet |

**Backup (free, no extra key):** if CricketData fails, runs out of daily requests or has no squad yet, `/api/fixtures` and `/api/squad` fall back to **Gemini Flash with Google Search** (`api/_backup.js`): a grounded search, then a schema-constrained call that turns the notes into fixtures or squad rows. Results are cached 6 h (fixtures) and 12 h (squads); empty answers are never cached. Add `?source=backup` to either endpoint to force it. The UI labels data that came from the backup. Final fallbacks: sample fixtures, and probable squads from Cricsheet.

### Refreshing the data

```bash
mkdir -p .cache/raw && cd .cache/raw
for f in tests_male_json odis_male_json t20s_male_json; do curl -sSLO https://cricsheet.org/downloads/$f.zip && unzip -qo $f.zip -d $f; done
curl -sSLo ../names.csv https://cricsheet.org/register/names.csv
cd ../.. && npm run data
```

The build geocodes venues and pulls match-day weather from Open-Meteo. Both are cached in `.cache/`, so reruns only fetch new matches. Open-Meteo allows about 5,000 requests an hour; if the build hits the limit it says so, and the next run fills the gap.

## Deploy (Vercel)

`vercel.json` serves `public/` as static files and `api/*.js` as functions. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`, `CRICAPI_KEY`) in the project's environment variables. AI endpoints: `POST /api/brief` (`mode: "brief" | "newsletter"`) and `POST /api/ask`; shared helper in `api/_gemini.js`.

## Notes

- Cricsheet withholds matches involving Afghanistan men, so AFG has no records here.
- "Surface" is a proxy: the first-innings total against format-wide thirds (since 2015). The pitch report itself comes from the Gemini search step.
- Weather buckets use the venue's daily means: humid ≥ 75% RH, overcast ≥ 60% cloud, dew point ≥ 18 °C, rain ≥ 5 mm, hot ≥ 33 °C, cool ≤ 20 °C.
- Data: [Cricsheet](https://cricsheet.org) (ODC-By), [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
