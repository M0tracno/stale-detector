# Stale-Answer Detector

**Problem Statement 06 (Tavily): AI-powered fact verification and information freshness**

LLMs state outdated facts with full confidence: old prices, deprecated API versions, former CEOs. Paste any AI-generated answer and this tool:

1. **Finds the claims.** It splits the answer into atomic factual claims and flags the time-sensitive ones (pricing, API versions, leadership, laws, stats).
2. **Checks them live.** It runs a Tavily search for the current state of each flagged claim.
3. **Spots what's out of date.** A stronger model, using only the live evidence, labels each claim `current`, `outdated`, `contradicted` or `unverifiable`.
4. **Scores freshness.** Each claim gets a score from 0 to 100, based on the verdict, the confidence, how fast that category goes stale, and how recent the newest evidence is.
5. **Fixes the answer.** It rewrites the answer with corrected facts and keeps source links on every claim.

## How Tavily and Bifrost are used

| Technology | Role |
|---|---|
| **Tavily** | Live web search for every flagged claim (`search_depth: advanced`). It returns the sources, snippets and published dates the verdict rests on. |
| **Bifrost by Maxim AI** | Gateway for **every** LLM call. It routes a cheap model for extraction and rewriting and a strong model for verification, and adds automatic provider fallback (`FALLBACK_MODELS`), virtual-key budgets and per-request observability. The UI shows each gateway call's route, latency and token use. |

```
answer ─► [Bifrost: fast model] extract claims
              │  time-sensitive only
              ▼
         [Tavily] live search per claim  (parallel)
              ▼
         [Bifrost: strong model] verdict + current fact + citations
              ▼
         freshness score (lib/score.ts) ─► [Bifrost: fast model] corrected answer
```

## Freshness score

Logic lives in `lib/score.ts`:

- The verdict sets the target: current ≈ 95, outdated ≈ 10, contradicted ≈ 5, unverifiable 50. Confidence pulls the score away from a neutral 50.
- Each category has a half-life: pricing 90 days, API versions 120, leadership 1 year, events 3 years, evergreen never.
- An unverifiable claim in a fast-changing category loses more points.
- A "current" verdict backed only by evidence older than the half-life is capped below "fresh".
- Status bands: **fresh** ≥ 70, **check** 40–69, **stale** < 40. The overall score blends the mean with the worst claim, so one stale fact drags the whole answer down.

## Run it

You need two free keys, and neither asks for a card:

- **Tavily:** sign up at [app.tavily.com](https://app.tavily.com) (1,000 searches a month free).
- **Groq:** sign up at [console.groq.com/keys](https://console.groq.com/keys). Bifrost uses this key for every model call.

```bash
npm install
cp .env.example .env.local      # fill in TAVILY_API_KEY and GROQ_API_KEY
```

Start Bifrost in one terminal. It reads `bifrost/config.json`, which takes the Groq key from the `GROQ_API_KEY` environment variable, so no key is ever committed.

```bash
# macOS / Linux / Git Bash
set -a; . ./.env.local; set +a; npm run bifrost
```

```powershell
# Windows PowerShell
$env:GROQ_API_KEY = "gsk_..."; npm run bifrost
```

Then start the app in a second terminal:

```bash
npm run dev                     # http://localhost:3000
```

The Bifrost dashboard at http://localhost:8080 shows a live log of every model request the app makes.

### Models and fallback

| Step | Model (through Bifrost) |
|---|---|
| Claim extraction and rewrite | `groq/openai/gpt-oss-20b` (fast, cheap) |
| Verification | `groq/openai/gpt-oss-120b` (strong) |
| Fallback | `groq/openai/gpt-oss-20b`. Bifrost switches to it automatically when the primary model is rate-limited. |

To change providers, add them to `bifrost/config.json` and set `FAST_MODEL`, `STRONG_MODEL` and `FALLBACK_MODELS` in `.env.local`. No code changes are needed.

## Tests and eval

```bash
npm test                        # scoring logic self-check
npm run eval                    # runs eval/cases.json against the running app and writes eval/results.json
```

`eval/cases.json` holds 19 labelled single-claim answers: 12 known-outdated facts and 7 still-true facts.

**Latest run (14 Nov 2026): 19/19 correct, 100% precision, 100% recall.** This is a small set and the models are non-deterministic, so expect occasional misses. Run it yourself to check.

The tool caught two of our own labels going out of date. We wrote "Jensen Huang is CEO of Nvidia" and "Keir Starmer leads the UK Labour Party" as current facts. The detector flagged both as outdated, citing November 2026 CNBC coverage and BBC and Wikipedia reports. We relabelled both cases (see the `note` field in `eval/cases.json`). This is exactly the problem the tool is built to solve.

## API

`POST /api/check` with body `{ "answer": "..." }` returns `{ overall, claims[], corrected, gateway[], searches[] }`.
