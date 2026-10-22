import type { PerceptionResult } from "../perception/run-perception";
import type { Finding } from "../types";

export interface LaunchReadinessInput {
  target: string;
  icp: string;
  result: PerceptionResult;
  /** Functional findings from a depth run, when there was one. */
  functional?: Finding[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const label = (category: string) => category.replace(/_/g, " ");

function renderExperiment(r: PerceptionResult): string[] {
  const p = r.pairAggregate!;
  const [a, b] = r.variants;
  const decided = p.winsA + p.winsB;
  const row = (v: "A" | "B", name: string, wins: number) => `| ${name} | ${wins} of ${decided} | ${v === p.leader ? `${pct(p.interval.low)}–${pct(p.interval.high)}` : ""} | ${(p.reasons[v] ?? []).slice(0, 2).join("; ")} |`;
  return [
    `## Variant comparison`,
    "",
    `| Variant | Chosen by | 95% interval (leader) | Why buyers chose it |`,
    `|---|---|---|---|`,
    row("A", a, p.winsA),
    row("B", b, p.winsB),
    "",
    `${p.neither} of ${r.pairs.length} buyers wanted neither. ${
      p.decisive
        ? `**${p.leader === "A" ? a : b} leads decisively**: its interval excludes a 50/50 split.`
        : `**No decisive winner**: the interval includes a 50/50 split, so this could be noise. Run more evaluators.`
    }`,
    `Position check: the option shown first won ${pct(p.firstShownWinShare)} of choices (50% means no order bias).`,
    "",
  ];
}

function renderObjections(r: PerceptionResult): string[] {
  return r.variants.flatMap((v) => {
    const a = r.aggregates[v];
    if (!a.objections.length) return [];
    return [
      ...(r.variants.length > 1 ? [`### ${v}`, ""] : []),
      ...a.objections.slice(0, 6).map((o) => `- **${label(o.category)}** — ${o.buyers} of ${a.evaluators} buyers. ${o.examples.map((e) => `"${e}"`).join(" ")}`),
      "",
    ];
  });
}

function renderSingle(r: PerceptionResult): string[] {
  const a = r.aggregates[r.variants[0]];
  const s = a.meanScores;
  return [
    `## How simulated buyers responded`,
    "",
    `Of ${a.evaluators} buyers: ${a.intent.yes} would buy, ${a.intent.maybe} might, ${a.intent.no} would not. This is a comparison baseline, not a conversion rate.`,
    `Average scores (1–5): clarity ${s.clarity.toFixed(1)}, credibility ${s.credibility.toFixed(1)}, value ${s.value.toFixed(1)}, urgency ${s.urgency.toFixed(1)}.`,
    a.wouldPay.answers
      ? `Of those who might buy, ${a.wouldPay.answers} named a price: median $${a.wouldPay.medianUsd}/month (${Object.entries(a.wouldPay.plans).map(([plan, n]) => `${plan} ×${n}`).join(", ")}).`
      : "",
    "",
    ...(a.confusions.length
      ? [`## Confusion points`, "", ...a.confusions.slice(0, 6).map((c) => `- ${c.exhibitId} (${c.count}): ${c.examples.map((e) => `"${e}"`).join(" ")}`), ""]
      : []),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "");
}

/** The top-level artifact. Comparative, grounded in counts, never a fake percentage. */
export function renderLaunchReadiness(i: LaunchReadinessInput): string {
  const r = i.result;
  const blockers = (i.functional ?? []).filter((f) => f.severity !== "minor" && f.confidence !== "low" && !f.sandboxCause);
  const cost = r.usage.costUsd !== undefined ? `$${r.usage.costUsd.toFixed(4)}` : "unknown";
  return [
    `# Launch Readiness: ${i.target}`,
    "",
    `> Simulated evidence — not real traction. ${r.evaluators} AI buyers matching "${i.icp}" judged ${r.mode === "experiment" ? `${r.variants.join(" vs ")}` : "the product"}; ${r.unusable} replies were unusable and left out.`,
    "",
    `## Verdict`,
    "",
    r.summary.verdict,
    "",
    `## Ranked blockers`,
    "",
    ...(blockers.length ? blockers.map((f) => `- [${f.severity.toUpperCase()}] ${f.title} (${f.hitBy.length} of ${f.visitors} agents)`) : ["_No functional blockers from the depth run._"]),
    "",
    ...(r.mode === "experiment" ? renderExperiment(r) : renderSingle(r)),
    `## Strongest objections`,
    "",
    ...renderObjections(r),
    `## Recommended fixes`,
    "",
    ...(r.summary.fixes.length ? r.summary.fixes.map((f, n) => `${n + 1}. ${f.fix} _(addresses: ${label(f.addresses)})_`) : ["_None suggested._"]),
    "",
    `## What would change our mind`,
    "",
    `These predictions are stored. Record what really happens (\`npm run debutly:predictions -- record <id> <actual>\`) to measure how well the simulation predicts.`,
    "",
    ...r.predictions.map((p) => `- [${p.metric}] ${p.claim}`),
    "",
    ...(r.market
      ? [`## Market context`, "", ...r.market.competitors.map((c) => `- **${c.name}**: ${c.pricing} (${c.positioning})`), `Sources: ${r.market.sources.join(", ") || "none"}`, ""]
      : []),
    `_Evaluator cost: ${cost} (${r.usage.inputTokens.toLocaleString("en-US")} input + ${r.usage.outputTokens.toLocaleString("en-US")} output tokens)._`,
    "",
  ].join("\n");
}
