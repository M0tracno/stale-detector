// Stale-answer pipeline: extract claims -> Tavily live search -> verify -> score -> rewrite.
// Every LLM call goes through Bifrost (OpenAI-compatible gateway); every search through Tavily.
import {
  type Category,
  type Verdict,
  type Status,
  freshnessScore,
  statusFor,
  overallScore,
} from "./score";

const BIFROST_URL = process.env.BIFROST_URL ?? "http://localhost:8080";
const FAST_MODEL = process.env.FAST_MODEL || "groq/llama-3.1-8b-instant";
const STRONG_MODEL = process.env.STRONG_MODEL || "groq/llama-3.3-70b-versatile";
const FALLBACK_MODELS = (process.env.FALLBACK_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_CLAIMS = 10;

export type GatewayCall = {
  step: string;
  model: string;
  provider?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
};

export type SearchCall = { query: string; latencyMs: number; results: number };

export type Source = { title: string; url: string; snippet: string; published?: string };

export type Claim = {
  id: number;
  text: string;
  quote: string; // exact span from the answer, used for highlighting
  category: Category;
  timeSensitive: boolean;
  query?: string;
  verdict?: Verdict;
  confidence?: number;
  currentFact?: string;
  reasoning?: string;
  evidenceDate?: string | null;
  sources?: Source[];
  score?: number;
  status?: Status;
};

export type CheckResult = {
  checkedAt: string;
  overall: number | null;
  claims: Claim[];
  corrected: string | null;
  gateway: GatewayCall[];
  searches: SearchCall[];
};

// ---------- Bifrost ----------

async function llm(step: string, model: string, system: string, user: string, log: GatewayCall[]) {
  const t0 = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.BIFROST_VIRTUAL_KEY) headers["x-bf-vk"] = process.env.BIFROST_VIRTUAL_KEY;

  const res = await fetch(`${BIFROST_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Bifrost retries these provider/models automatically if the primary fails
      ...(FALLBACK_MODELS.length ? { fallbacks: FALLBACK_MODELS } : {}),
    }),
  }).catch((e) => {
    throw new Error(`Cannot reach Bifrost at ${BIFROST_URL} (${e.message}). Start it with: npx -y @maximhq/bifrost`);
  });
  if (!res.ok) throw new Error(`Bifrost ${step} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();

  log.push({
    step,
    model: data.model ?? model,
    provider: data.extra_fields?.provider,
    latencyMs: Date.now() - t0,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  });
  return String(data.choices?.[0]?.message?.content ?? "");
}

function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Model did not return JSON: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

// ---------- Tavily ----------

async function search(query: string, log: SearchCall[]): Promise<Source[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, search_depth: "advanced", max_results: 5, include_answer: false }),
  });
  if (!res.ok) throw new Error(`Tavily failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const results: Source[] = (data.results ?? []).map((r: Record<string, string>) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content ?? "").slice(0, 600),
    published: r.published_date || undefined,
  }));
  log.push({ query, latencyMs: Date.now() - t0, results: results.length });
  return results;
}

// ---------- Steps ----------

const CATEGORY_LIST = [
  "pricing", "api_version", "product_feature", "leadership",
  "law_regulation", "statistic", "event", "evergreen",
];

async function extractClaims(answer: string, today: string, log: GatewayCall[]): Promise<Claim[]> {
  const raw = await llm(
    "extract",
    FAST_MODEL,
    `You split an AI-generated answer into atomic factual claims. Today is ${today}.
Return ONLY JSON: {"claims":[{"text":"standalone claim","quote":"exact substring copied verbatim from the answer","category":"${CATEGORY_LIST.join(" | ")}","time_sensitive":true|false,"query":"web search query that would confirm the claim's CURRENT status"}]}
time_sensitive = the fact could have changed since it was written (prices, versions, who holds a role, laws, rankings, stats, "latest X").
Skip opinions and instructions. "quote" must match the answer text exactly; keep it short (the key phrase).`,
    answer,
    log,
  );
  const parsed = parseJson<{ claims: Array<Record<string, unknown>> }>(raw);
  return (parsed.claims ?? []).map((c, i) => {
    const category = (CATEGORY_LIST.includes(String(c.category)) ? c.category : "statistic") as Category;
    return {
      id: i + 1,
      text: String(c.text ?? ""),
      quote: String(c.quote ?? ""),
      category,
      timeSensitive: Boolean(c.time_sensitive) && category !== "evergreen",
      query: c.query ? String(c.query) : undefined,
    };
  });
}

async function verifyClaim(claim: Claim, today: string, gw: GatewayCall[], sl: SearchCall[]): Promise<Claim> {
  const sources = await search(claim.query || claim.text, sl);
  const evidence = sources
    .map((s, i) => `[${i + 1}] ${s.title} (${s.published ?? "date unknown"}) ${s.url}\n${s.snippet}`)
    .join("\n\n");

  const raw = await llm(
    `verify #${claim.id}`,
    STRONG_MODEL,
    `You fact-check whether a claim is STILL TRUE today (${today}) using only the live search evidence given.
Return ONLY JSON: {"verdict":"current|outdated|contradicted|unverifiable","confidence":0.0-1.0,"current_fact":"what is true now, one sentence","evidence_date":"YYYY-MM-DD of newest relevant source or null","citations":[source numbers],"reasoning":"one sentence"}
current = evidence shows it is still true. outdated = it was true once but has changed. contradicted = it was never true.
unverifiable = evidence does not settle it. Never use outside knowledge to override the evidence.`,
    `Claim: ${claim.text}\n\nEvidence:\n${evidence || "(no results)"}`,
    gw,
  );
  const v = parseJson<{
    verdict: Verdict;
    confidence: number;
    current_fact?: string;
    evidence_date?: string | null;
    citations?: number[];
    reasoning?: string;
  }>(raw);

  const verdict: Verdict = ["current", "outdated", "contradicted", "unverifiable"].includes(v.verdict)
    ? v.verdict
    : "unverifiable";
  const confidence = Number(v.confidence) || 0;
  const evidenceTime = v.evidence_date ? Date.parse(v.evidence_date) : NaN;
  const newestEvidenceDays = Number.isFinite(evidenceTime)
    ? Math.max(0, (Date.parse(today) - evidenceTime) / 86_400_000)
    : null;
  const score = freshnessScore({ verdict, confidence, category: claim.category, newestEvidenceDays });
  const cited = (v.citations ?? []).map((n) => sources[n - 1]).filter(Boolean);

  return {
    ...claim,
    verdict,
    confidence,
    currentFact: v.current_fact,
    reasoning: v.reasoning,
    evidenceDate: v.evidence_date ?? null,
    sources: cited.length ? cited : sources.slice(0, 3),
    score,
    status: statusFor(score),
  };
}

async function rewrite(answer: string, claims: Claim[], log: GatewayCall[]): Promise<string | null> {
  const fixes = claims.filter((c) => c.status && c.status !== "fresh" && c.currentFact);
  if (!fixes.length) return null;
  return llm(
    "rewrite",
    FAST_MODEL,
    "Rewrite the answer, replacing only the outdated statements with the corrected facts given. Keep everything else, keep the tone and length. Return only the rewritten answer.",
    `Answer:\n${answer}\n\nCorrections:\n${fixes.map((c) => `- "${c.quote}" -> ${c.currentFact}`).join("\n")}`,
    log,
  );
}

export async function checkAnswer(answer: string): Promise<CheckResult> {
  const today = new Date().toISOString().slice(0, 10);
  const gateway: GatewayCall[] = [];
  const searches: SearchCall[] = [];

  const claims = await extractClaims(answer, today, gateway);
  const toCheck = claims.filter((c) => c.timeSensitive).slice(0, MAX_CLAIMS);

  const verified = await Promise.all(
    toCheck.map((c) =>
      verifyClaim(c, today, gateway, searches).catch(
        (e): Claim => ({ ...c, verdict: "unverifiable", reasoning: `Check failed: ${e.message}`, score: 40, status: "check" }),
      ),
    ),
  );
  const byId = new Map(verified.map((c) => [c.id, c]));
  const merged = claims.map((c) => byId.get(c.id) ?? c);

  const corrected = await rewrite(answer, merged, gateway).catch(() => null);

  return {
    checkedAt: new Date().toISOString(),
    overall: overallScore(verified.map((c) => c.score ?? 50)),
    claims: merged,
    corrected,
    gateway,
    searches,
  };
}
