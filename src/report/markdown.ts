import { describeAction } from "../agent/describe";
import { MEASURED } from "../detect/findings";
import { describeCriterion } from "../detect/wcag";
import { OUT_OF_CREDITS } from "../llm/types";
import type { CustomerUnit, Finding, Session } from "../types";

export interface ReportInput {
  targetUrl: string;
  goal: string;
  sessions: Session[];
  findings: Finding[];
  units?: CustomerUnit[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  model?: string;
}

function renderCost(usage: ReportInput["usage"], model?: string): string[] {
  if (!usage || usage.inputTokens + usage.outputTokens === 0) return [];
  const tokens = `${usage.inputTokens.toLocaleString("en-US")} input + ${usage.outputTokens.toLocaleString("en-US")} output tokens${model ? ` on ${model}` : ""}`;
  return [`Cost: ${usage.costUsd !== undefined ? `$${usage.costUsd.toFixed(4)}` : "unknown"} (${tokens})  `];
}

function renderFinding(f: Finding, sessions: Session[]): string {
  const lines = [
    `### [${f.severity.toUpperCase()}] ${f.title}`,
    "",
    f.detail,
    "",
    MEASURED.has(f.kind)
      ? `Measured by the browser on ${f.pagePath}, by ${f.hitBy.length} of ${f.visitors} agents who visited it.`
      : `Hit by ${f.hitBy.length} of ${f.visitors} agents who visited ${f.pagePath} (${f.confidence} confidence).`,
  ];
  if (f.wcag?.length) lines.push("", `Related WCAG 2.2: ${f.wcag.map(describeCriterion).join(", ")}, for a person to check.`);
  const ev = f.evidence[0];
  const session = sessions.find((s) => s.agentId === ev?.agentId);
  if (ev && session) {
    lines.push("", `Reproduction (${session.personaName}):`, "");
    for (const step of session.steps.slice(0, ev.stepIndex + 1)) {
      lines.push(`${step.index + 1}. ${describeAction(step.action, step.observation)} — "${step.reasoning}"`);
    }
    const shot = session.steps[ev.stepIndex]?.screenshotPath;
    if (shot) lines.push("", `Screenshot: ${shot}`);
  }
  return lines.join("\n");
}

const STOP_VERB: Partial<Record<Session["outcome"], string>> = {
  gave_up: "gave up",
  error: "stopped with an error",
  budget_exhausted: "ran out of steps",
  not_invited: "never got an invite",
  cancelled: "was cancelled",
};

const OWNER_VERB: Record<Session["outcome"], string> = {
  success: "succeeded",
  gave_up: "gave up",
  error: "hit an engine error",
  budget_exhausted: "ran out of steps",
  not_invited: "never got an invite",
  cancelled: "was cancelled",
};

// One line per business crew: did the owner get through, and did the team get in?
function renderUnits(units: CustomerUnit[], sessions: Session[]): string[] {
  const crews = units.filter((u) => u.kind === "business");
  if (!crews.length) return [];
  const lines = crews.map((u) => {
    const mine = sessions.filter((s) => s.unitId === u.id);
    const owner = mine.find((s) => s.agentId === u.owner.id);
    const team = mine.filter((s) => s.agentId !== u.owner.id);
    const inTeam = team.filter((s) => s.outcome === "success").length;
    const missing = team.filter((s) => s.outcome !== "success").map((s) => `${s.personaName}: ${s.outcomeNote}`);
    const b = u.business;
    const head = `**${b.name}** (${b.archetype}, ~${b.size} people, $${b.monthlyBudget}/mo): owner ${u.owner.name} ${owner ? OWNER_VERB[owner.outcome] : "did not run"}`;
    if (!team.length) return `- ${head}`;
    return `- ${head}; ${inTeam} of ${team.length} teammates got in${missing.length ? ` (${missing.join("; ")})` : ""}`;
  });
  return [`## Customer units`, "", ...lines, ""];
}

const needLabel = (s: Session) => (s.inclusion ? s.inclusion.replace(/_/g, " ") : "—");

// The agents' own reasons are often the clearest statement of a blocker.
function renderStops(sessions: Session[]): string {
  const lines = sessions.flatMap((s) => {
    const verb = STOP_VERB[s.outcome];
    if (!verb) return [];
    const last = s.steps.at(-1)?.observation.url;
    let where = "";
    try {
      where = last ? ` on ${new URL(last).pathname}` : "";
    } catch {
      where = "";
    }
    return [`- **${s.personaName}** ${verb}${where}: "${s.outcomeNote}"`];
  });
  return lines.length ? lines.join("\n") : "_Every agent reached its goal._";
}

const MISSING_KEY_PREFIX = "missing key: ";
const MADE_UP_SITE_PREFIX = "made-up site: ";

/** Why the test environment, not the app, explains a failure: blocked hosts, a missing key, a made-up site. */
function sandboxCauseLine(f: Finding): string {
  const causes = f.sandboxCause ?? [];
  const hosts = causes.filter((c) => !c.startsWith(MISSING_KEY_PREFIX) && !c.startsWith(MADE_UP_SITE_PREFIX));
  const said = causes.filter((c) => c.startsWith(MISSING_KEY_PREFIX)).map((c) => `"${c.slice(MISSING_KEY_PREFIX.length)}"`);
  const sites = causes.filter((c) => c.startsWith(MADE_UP_SITE_PREFIX)).map((c) => c.slice(MADE_UP_SITE_PREFIX.length));
  return [
    hosts.length ? `Blocked at the same moment: ${hosts.join(", ")}.` : "",
    said.length ? `The app said a key or setting is missing: ${said.join("; ")}.` : "",
    sites.length ? `The app couldn't reach the website the agent made up for its company: ${sites.join(", ")}.` : "",
    `Hit by ${f.hitBy.length} of ${f.visitors} agents who visited ${f.pagePath}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// Agents the AI provider stopped for lack of credit: the run is incomplete, and not because of the app.
function renderOutOfCredits(sessions: Session[]): string[] {
  const stopped = sessions.filter((s) => s.outcome === "error" && s.outcomeNote.startsWith(OUT_OF_CREDITS));
  if (!stopped.length) return [];
  return [
    `## Run cut short`,
    "",
    `The AI provider account ran out of credits, so ${stopped.length} of ${sessions.length} agents stopped early: ${stopped.map((s) => s.personaName).join(", ")}. That is not the app's doing. Findings cover only the steps they took. Top up the account and run again.`,
    "",
  ];
}

// Failures the test environment explains (it blocked an outbound call, or has no key the app
// needs): likely not the app's fault.
function renderSandboxCaused(caused: Finding[]): string[] {
  if (!caused.length) return [];
  return [
    `## Caused by the test environment`,
    "",
    `The test environment blocks the app from reaching real outside services and has none of its secret keys, so nothing leaks and nothing is charged. Each of these failures happened while it was blocking a call, or the app said a key was missing, or it couldn't reach a website the agent made up, so they probably don't happen on the real app. Check there if in doubt.`,
    "",
    ...caused.flatMap((f) => [`### ${f.title}`, "", f.detail, "", sandboxCauseLine(f), ""]),
  ];
}

export function renderReport(input: ReportInput): string {
  const caused = input.findings.filter((f) => f.sandboxCause);
  const real = input.findings.filter((f) => !f.sandboxCause);
  const confident = real.filter((f) => f.confidence !== "low");
  const low = real.filter((f) => f.confidence === "low");
  const count = (s: Finding["severity"]) => confident.filter((f) => f.severity === s).length;

  return [
    `# Debutly Report`,
    "",
    `> Simulated evidence — not real traction. Findings come from AI agents, not real users.`,
    "",
    `Target: ${input.targetUrl}  `,
    `Goal: ${input.goal}  `,
    `Agents: ${input.sessions.length}  `,
    ...renderCost(input.usage, input.model),
    `Findings: ${count("blocker")} blocker, ${count("major")} major, ${count("minor")} minor (${low.length} low-confidence${caused.length ? `, ${caused.length} caused by the test environment` : ""})`,
    "",
    ...renderOutOfCredits(input.sessions),
    ...renderUnits(input.units ?? [], input.sessions),
    `## Agent outcomes`,
    "",
    `| Persona | Role | Needs | Outcome | Note |`,
    `|---|---|---|---|---|`,
    ...input.sessions.map((s) => `| ${s.personaName} | ${s.role ?? "—"} | ${needLabel(s)} | ${s.outcome} | ${s.outcomeNote} |`),
    "",
    `## Where agents stopped`,
    "",
    renderStops(input.sessions),
    "",
    `## Findings`,
    "",
    ...(input.findings.some((f) => f.wcag?.length)
      ? [
          `WCAG references point to what a person should check. Debutly doesn't test conformance, and a run without such findings says nothing about it.`,
          "",
        ]
      : []),
    confident.length ? confident.map((f) => renderFinding(f, input.sessions)).join("\n\n") : "_None._",
    "",
    `## Low-confidence findings`,
    "",
    `Few of the agents that reached these pages hit these issues. They may be agent errors rather than product bugs.`,
    "",
    low.length ? low.map((f) => renderFinding(f, input.sessions)).join("\n\n") : "_None._",
    "",
    ...renderSandboxCaused(caused),
    "---",
    "",
    "Rehearsed with [Debutly](https://debutly.dev).",
    "",
  ].join("\n");
}
