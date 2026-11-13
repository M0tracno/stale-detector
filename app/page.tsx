"use client";

import { useState } from "react";
import type { CheckResult, Claim } from "@/lib/pipeline";

const SAMPLES: Record<string, string> = {
  "Tech stack advice":
    "For a new web app I'd use React 17 with Create React App, since it's the officially recommended way to start a React project. Deploy on Node.js 16, which is the current LTS release. Python 3.9 is the latest stable version if you need a backend script.",
  "Company facts":
    "Twitter, led by CEO Parag Agrawal, is the go-to platform for real-time news. Meanwhile Amazon is run by Jeff Bezos, and Satya Nadella is the CEO of Microsoft.",
  "AI pricing":
    "OpenAI's most advanced model is GPT-4, and ChatGPT Plus costs $20 per month. GitHub Copilot is free only for verified students and open-source maintainers.",
};

const STATUS_STYLE = {
  fresh: { bar: "bg-emerald-400", text: "text-emerald-300", mark: "bg-emerald-400/20 decoration-emerald-400", label: "Fresh" },
  check: { bar: "bg-amber-400", text: "text-amber-300", mark: "bg-amber-400/20 decoration-amber-400", label: "Check" },
  stale: { bar: "bg-rose-500", text: "text-rose-300", mark: "bg-rose-500/25 decoration-rose-500", label: "Stale" },
} as const;

function statusOf(c: Claim) {
  return c.status ? STATUS_STYLE[c.status] : null;
}

// Split the answer into plain text and highlighted claim spans.
function segments(answer: string, claims: Claim[]) {
  const ranges: { start: number; end: number; claim: Claim }[] = [];
  const lower = answer.toLowerCase();
  for (const c of claims) {
    if (!c.status || !c.quote) continue;
    const start = lower.indexOf(c.quote.toLowerCase());
    if (start >= 0) ranges.push({ start, end: start + c.quote.length, claim: c });
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: { text: string; claim?: Claim }[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start < pos) continue; // overlapping quote, skip
    if (r.start > pos) out.push({ text: answer.slice(pos, r.start) });
    out.push({ text: answer.slice(r.start, r.end), claim: r.claim });
    pos = r.end;
  }
  if (pos < answer.length) out.push({ text: answer.slice(pos) });
  return out;
}

export default function Home() {
  const [answer, setAnswer] = useState(SAMPLES["Tech stack advice"]);
  const [checked, setChecked] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  async function run() {
    setLoading(true);
    setError("");
    setResult(null);
    setActive(null);
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setChecked(answer.trim());
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const verified = result?.claims.filter((c) => c.status) ?? [];
  const counts = { fresh: 0, check: 0, stale: 0 };
  verified.forEach((c) => counts[c.status!]++);
  const totalTokens = result?.gateway.reduce((s, g) => s + (g.promptTokens ?? 0) + (g.completionTokens ?? 0), 0) ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 font-sans">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Tavily × Bifrost</p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Stale-Answer Detector</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Paste any AI-generated answer. We pull out time-sensitive claims, re-check each one against live web
          sources, and score how fresh it still is.
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(SAMPLES).map(([name, text]) => (
            <button
              key={name}
              onClick={() => setAnswer(text)}
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:border-cyan-400/60 hover:text-white"
            >
              {name}
            </button>
          ))}
        </div>
        <label htmlFor="answer" className="sr-only">AI answer to check</label>
        <textarea
          id="answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-lg border border-white/10 bg-black/40 p-3 text-sm leading-relaxed outline-none focus:border-cyan-400/60"
          placeholder="Paste an answer from ChatGPT, Claude, Gemini..."
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading || !answer.trim()}
            className="rounded-lg bg-cyan-400 px-5 py-2 text-sm font-semibold text-black hover:bg-cyan-300 disabled:opacity-40"
          >
            {loading ? "Checking…" : "Check freshness"}
          </button>
          {loading && (
            <span className="text-xs text-slate-400">Extracting claims → searching live sources → verifying…</span>
          )}
        </div>
        {error && <p className="mt-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
      </section>

      {result && (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-4">
            <Stat label="Freshness score" value={result.overall == null ? "—" : `${result.overall}/100`} />
            <Stat label="Stale" value={String(counts.stale)} tone="text-rose-300" />
            <Stat label="Needs check" value={String(counts.check)} tone="text-amber-300" />
            <Stat label="Fresh" value={String(counts.fresh)} tone="text-emerald-300" />
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Answer, annotated</h2>
              <p className="whitespace-pre-wrap text-[15px] leading-8">
                {segments(checked, result.claims).map((s, i) =>
                  s.claim ? (
                    <button
                      key={i}
                      onClick={() => setActive(s.claim!.id)}
                      className={`rounded px-0.5 underline decoration-2 underline-offset-4 ${statusOf(s.claim)!.mark} ${active === s.claim.id ? "ring-1 ring-white/60" : ""}`}
                    >
                      {s.text}
                      <sup className="ml-0.5 text-[10px] text-slate-400">{s.claim.id}</sup>
                    </button>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </p>
              {result.corrected && (
                <>
                  <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-300">Corrected answer</h2>
                  <p className="whitespace-pre-wrap rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm leading-7">
                    {result.corrected}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-3">
              {verified.length === 0 && (
                <p className="text-sm text-slate-400">No time-sensitive claims found.</p>
              )}
              {verified.map((c) => (
                <ClaimCard key={c.id} claim={c} active={active === c.id} onClick={() => setActive(c.id)} />
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sm font-semibold text-slate-300">Under the hood</h2>
            <p className="mt-1 text-xs text-slate-500">
              {result.gateway.length} model calls via Bifrost · {totalTokens.toLocaleString()} tokens ·{" "}
              {result.searches.length} live Tavily searches
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Step</th>
                    <th className="py-1 pr-4 font-medium">Route</th>
                    <th className="py-1 pr-4 font-medium">Latency</th>
                    <th className="py-1 font-medium">Tokens in / out</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-slate-300">
                  {result.gateway.map((g, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-1.5 pr-4">{g.step}</td>
                      <td className="py-1.5 pr-4">bifrost · {g.provider ? `${g.provider} · ` : ""}{g.model}</td>
                      <td className="py-1.5 pr-4">{g.latencyMs} ms</td>
                      <td className="py-1.5">{g.promptTokens ?? "?"} / {g.completionTokens ?? "?"}</td>
                    </tr>
                  ))}
                  {result.searches.map((s, i) => (
                    <tr key={`s${i}`} className="border-t border-white/5 text-cyan-200/80">
                      <td className="py-1.5 pr-4">search</td>
                      <td className="py-1.5 pr-4">tavily · “{s.query}”</td>
                      <td className="py-1.5 pr-4">{s.latencyMs} ms</td>
                      <td className="py-1.5">{s.results} results</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function ClaimCard({ claim: c, active, onClick }: { claim: Claim; active: boolean; onClick: () => void }) {
  const s = statusOf(c)!;
  return (
    <article
      onClick={onClick}
      className={`cursor-pointer rounded-xl border bg-white/[0.03] p-4 ${active ? "border-white/40" : "border-white/10"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs font-semibold uppercase tracking-wide ${s.text}`}>
          #{c.id} · {s.label} · {c.verdict}
        </span>
        <span className="text-xs text-slate-400">{c.category.replace("_", " ")}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10">
        <div className={`h-full ${s.bar}`} style={{ width: `${c.score}%` }} />
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-500">freshness {c.score}/100</p>
      <p className="mt-1 text-sm text-slate-300">“{c.text}”</p>
      {c.currentFact && (
        <p className="mt-2 text-sm">
          <span className="text-slate-500">Now: </span>
          {c.currentFact}
        </p>
      )}
      {c.reasoning && <p className="mt-1 text-xs text-slate-500">{c.reasoning}</p>}
      {!!c.sources?.length && (
        <ul className="mt-2 space-y-1">
          {c.sources.map((src) => (
            <li key={src.url} className="truncate text-xs">
              <a href={src.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">
                {src.title || src.url}
              </a>
              {src.published && <span className="text-slate-500"> · {src.published.slice(0, 16)}</span>}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
