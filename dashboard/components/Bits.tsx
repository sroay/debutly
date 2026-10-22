import Link from "next/link";
import type { FindingCounts, RunSummary, StoredFinding } from "../lib/queries";
import { outcomeLabel, outcomeTone, successTone } from "../lib/format";
import { LocalTime } from "./LocalTime";

export function OutcomeChip({ outcome }: { outcome: string | null | undefined }) {
  return <span className={`chip ${outcomeTone(outcome)}`}>{outcomeLabel(outcome)}</span>;
}

const SEVERITY_TONE: Record<string, string> = { blocker: "bad", major: "warn", minor: "info" };
export function SeverityChip({ severity }: { severity: string }) {
  return <span className={`chip ${SEVERITY_TONE[severity] ?? ""}`}>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>;
}

/** The app's own findings by severity, then the doubtful and the test environment's, only when there are any. */
export function FindingCountChips({ counts }: { counts: FindingCounts }) {
  const real = counts.blocker + counts.major + counts.minor;
  return (
    <span className="row">
      {counts.blocker > 0 && <span className="chip bad">{counts.blocker} blocker</span>}
      {counts.major > 0 && <span className="chip warn">{counts.major} major</span>}
      {counts.minor > 0 && <span className="chip info">{counts.minor} minor</span>}
      {real === 0 && <span className="chip good">No app bugs</span>}
      {counts.env > 0 && (
        <span className="chip" title="Caused by the test environment (blocked outside calls, missing keys, made-up websites)">
          {counts.env} test env
        </span>
      )}
      {counts.low > 0 && (
        <span className="chip" title="Seen by few agents; may be the agent's own mistake">
          {counts.low} doubtful
        </span>
      )}
    </span>
  );
}

/** One bar per run, oldest first: height and colour by the share of agents who finished. */
export function Trend({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="trend" aria-label="Recent runs: share of agents who finished">
      {runs.map((r) => {
        const share = r.agents ? r.succeeded / r.agents : 0;
        return (
          <Link
            key={r.id}
            href={`/runs/${r.id}`}
            className={successTone(r.succeeded, r.agents)}
            style={{ height: `${Math.max(8, share * 100)}%` }}
            title={`${r.createdAt.toISOString().slice(0, 10)}: ${r.succeeded} of ${r.agents} agents finished`}
            aria-label={`Run on ${r.createdAt.toISOString().slice(0, 10)}: ${r.succeeded} of ${r.agents} finished`}
          />
        );
      })}
    </div>
  );
}

export function FindingItem({ f, runId, agentNames }: { f: StoredFinding; runId: string; agentNames: Record<string, string> }) {
  return (
    <div className={`finding ${f.class === "real" ? f.severity : ""}`}>
      <div className="body">
        <div className="row">
          {f.class === "real" ? <SeverityChip severity={f.severity} /> : <span className="chip">{f.class === "env" ? "Test environment" : "Doubtful"}</span>}
          <strong>{f.title}</strong>
        </div>
        <p className="detail">{f.detail}</p>
        {f.sandboxCause && (
          <p className="detail">
            Test environment:{" "}
            {f.sandboxCause.map((c) => c.replace(/^missing key: /, "the app said a key is missing: ").replace(/^made-up site: /, "couldn't reach the agent's made-up website ")).join("; ")}
          </p>
        )}
        <div className="row small muted">
          <span>
            Hit by {f.hitBy.length} of {f.visitors} agents on <code>{f.pagePath}</code>
          </span>
          {f.evidence.slice(0, 4).map((e) => (
            <Link key={`${e.agentId}-${e.stepIndex}`} href={`/runs/${runId}/agents/${e.agentId}?step=${e.stepIndex}`}>
              {agentNames[e.agentId] ?? e.agentId}, step {e.stepIndex + 1}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function When({ date }: { date: Date }) {
  return <LocalTime iso={date.toISOString()} />;
}
