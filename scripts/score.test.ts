// Run: node scripts/score.test.ts   (Node 23.6+ strips types natively)
import assert from "node:assert/strict";
import { freshnessScore, statusFor, overallScore } from "../lib/score.ts";

// confident current claim with fresh evidence = fresh
const fresh = freshnessScore({ verdict: "current", confidence: 1, category: "pricing", newestEvidenceDays: 5 });
assert.ok(fresh >= 90, `fresh=${fresh}`);
assert.equal(statusFor(fresh), "fresh");

// confident outdated claim = stale
const stale = freshnessScore({ verdict: "outdated", confidence: 0.9, category: "api_version" });
assert.equal(statusFor(stale), "stale");

// unverifiable pricing riskier than unverifiable event
const p = freshnessScore({ verdict: "unverifiable", confidence: 0.5, category: "pricing" });
const e = freshnessScore({ verdict: "unverifiable", confidence: 0.5, category: "event" });
assert.ok(p < e, `pricing ${p} should be < event ${e}`);

// "current" backed only by 2-year-old pricing evidence can't be fresh
const old = freshnessScore({ verdict: "current", confidence: 1, category: "pricing", newestEvidenceDays: 730 });
assert.notEqual(statusFor(old), "fresh");

// zero confidence = neutral
assert.equal(freshnessScore({ verdict: "outdated", confidence: 0, category: "evergreen" }), 50);

// overall dragged down by worst claim
assert.ok(overallScore([95, 95, 10])! < 70);
assert.equal(overallScore([]), null);

console.log("score tests passed");
