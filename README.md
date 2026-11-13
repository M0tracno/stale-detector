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
- **An LLM provider for Bifrost:** [Groq](https://console.groq.com/keys) is the default, or use [Gemini](https://aistudio.google.com/apikey).

```bash
# 1. Start Bifrost, then add your Groq (or Gemini/OpenAI) key under Providers in its UI at http://localhost:8080
npx -y @maximhq/bifrost

# 2. Configure the app
cp .env.example .env.local   # fill in TAVILY_API_KEY, set FAST_MODEL / STRONG_MODEL to models you enabled

# 3. Run the app
npm install
npm run dev                  # http://localhost:3000
```

## Tests and eval

```bash
npm test            # scoring logic self-check
npm run eval        # runs eval/cases.json against the running app and writes eval/results.json
```

`eval/cases.json` holds labelled answers: known-outdated facts and still-true facts. The eval reports accuracy, precision and recall for stale detection.

## API

`POST /api/check` with body `{ "answer": "..." }` returns `{ overall, claims[], corrected, gateway[], searches[] }`.
