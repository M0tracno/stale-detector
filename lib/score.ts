// Freshness scoring. Pure functions, no I/O — see scripts/score.test.ts.

export type Category =
  | "pricing"
  | "api_version"
  | "product_feature"
  | "leadership"
  | "law_regulation"
  | "statistic"
  | "event"
  | "evergreen";

export type Verdict = "current" | "outdated" | "contradicted" | "unverifiable";

// How fast facts in each category go stale (half-life in days).
export const HALF_LIFE_DAYS: Record<Category, number> = {
  pricing: 90,
  api_version: 120,
  product_feature: 150,
  statistic: 180,
  leadership: 365,
  law_regulation: 365,
  event: 1095,
  evergreen: Infinity,
};

const VERDICT_BASE: Record<Verdict, number> = {
  current: 95,
  outdated: 10,
  contradicted: 5,
  unverifiable: 50,
};

/**
 * Freshness score 0-100 (higher = safer to trust today).
 * - Verdict sets the target, confidence pulls it away from neutral 50.
 * - Unverifiable claims lose points by how volatile their category is.
 * - Old evidence (newest source far in the past) caps "current" claims.
 */
export function freshnessScore(input: {
  verdict: Verdict;
  confidence: number; // 0..1
  category: Category;
  newestEvidenceDays?: number | null; // age of newest supporting source
}): number {
  const conf = Math.min(1, Math.max(0, input.confidence));
  let score = 50 + (VERDICT_BASE[input.verdict] - 50) * conf;

  const halfLife = HALF_LIFE_DAYS[input.category];
  if (input.verdict === "unverifiable" && Number.isFinite(halfLife)) {
    // pricing (90d) loses ~20 pts, events (3y) lose ~2
    score -= 20 * (90 / halfLife);
  }

  if (input.verdict === "current" && input.newestEvidenceDays != null && Number.isFinite(halfLife)) {
    // evidence older than one half-life can't prove it's still true
    const decay = Math.pow(0.5, input.newestEvidenceDays / halfLife);
    score = Math.min(score, 40 + 60 * decay);
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

export type Status = "fresh" | "check" | "stale";

export function statusFor(score: number): Status {
  if (score >= 70) return "fresh";
  if (score >= 40) return "check";
  return "stale";
}

export function overallScore(scores: number[]): number | null {
  if (!scores.length) return null;
  // weakest claim drags the answer down: blend mean with minimum
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(0.6 * mean + 0.4 * Math.min(...scores));
}
