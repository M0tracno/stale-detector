// Accuracy eval against labelled answers. Needs the app running (npm run dev).
// Usage: node scripts/eval.mjs [baseUrl]
import { readFile, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:3000";
const cases = JSON.parse(await readFile(new URL("../eval/cases.json", import.meta.url), "utf8"));

let tp = 0, fp = 0, fn = 0, tn = 0;
const rows = [];

for (const c of cases) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: c.answer }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.log(`ERROR  ${c.answer}\n       ${data.error}`);
    rows.push({ ...c, predicted: "error" });
    continue;
  }
  const flagged = data.claims.some((x) => x.status === "stale");
  const predicted = flagged ? "stale" : "current";
  if (predicted === "stale" && c.expected === "stale") tp++;
  if (predicted === "stale" && c.expected === "current") fp++;
  if (predicted === "current" && c.expected === "stale") fn++;
  if (predicted === "current" && c.expected === "current") tn++;
  const ok = predicted === c.expected ? "PASS " : "FAIL ";
  console.log(`${ok} [${data.overall ?? "-"}] ${c.answer}  (${Date.now() - t0} ms)`);
  rows.push({ ...c, predicted, overall: data.overall });
}

const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
const accuracy = (tp + tn) / (tp + tn + fp + fn || 1);
const summary = {
  cases: cases.length,
  accuracy: +accuracy.toFixed(3),
  precision: +precision.toFixed(3),
  recall: +recall.toFixed(3),
  confusion: { tp, fp, fn, tn },
  ranAt: new Date().toISOString(),
};
console.log("\n", summary);
await writeFile(new URL("../eval/results.json", import.meta.url), JSON.stringify({ summary, rows }, null, 2));
