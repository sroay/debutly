import Link from "next/link";
import { notFound } from "next/navigation";
import { describeAction } from "../../../../../../../src/agent/describe";
import { describeEffect } from "../../../../../../../src/agent/effect";
import { OutcomeChip, SeverityChip, When } from "../../../../../../components/Bits";
import { NoRuns, NotConnected } from "../../../../../../components/Empty";
import { StepKeys } from "../../../../../../components/StepKeys";
import { dbConfigured, getDb, schemaReady } from "../../../../../../lib/db";
import { appLabel, money, needLabel, pathOf, screenshotSrc } from "../../../../../../lib/format";
import { sessionReplay } from "../../../../../../lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Replay" };

export default async function Replay(props: { params: Promise<{ id: string; agentId: string }>; searchParams: Promise<{ step?: string }> }) {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const { id, agentId } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const replay = await sessionReplay(getDb(), id, decodeURIComponent(agentId));
  if (!replay) notFound();
  const { run, agent, session, steps, findingsAt } = replay;

  const wanted = Number((await props.searchParams).step ?? 0);
  const at = Math.min(Math.max(Number.isFinite(wanted) ? wanted : 0, 0), Math.max(steps.length - 1, 0));
  const step = steps[at];
  const href = (i: number) => `/runs/${run.id}/agents/${encodeURIComponent(agent.id)}?step=${i}`;
  const prev = at > 0 ? href(at - 1) : null;
  const next = at < steps.length - 1 ? href(at + 1) : null;
  const shot = step ? screenshotSrc(step.screenshotUrl) : null;
  // What a person would have noticed after this step: the engine's own description, from the next step's page.
  const after =
    step && steps[at + 1]
      ? describeEffect(step.action, step.observation, steps[at + 1].observation, step.signals, { error: step.error ?? undefined, blocked: step.blocked ?? undefined })
      : null;
  const httpErrors = step?.signals.flatMap((s) => (s.kind === "http_error" ? [`HTTP ${s.status} from ${pathOf(s.requestUrl)}`] : [])) ?? [];

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          <Link href={`/runs/${run.id}`}>
            {appLabel(run.app)} run, <When date={run.createdAt} />
          </Link>
        </span>
        <h1>{agent.name}</h1>
        <div className="row">
          {agent.role && <span className="muted">{agent.role}</span>}
          {agent.inclusion && <span className="chip">{needLabel(agent.inclusion)}</span>}
          <OutcomeChip outcome={session?.outcome} />
          <span className="small muted num">
            {steps.length} steps · {money(session?.costUsd)}
          </span>
        </div>
        {session?.outcomeNote && <p className="sub">{session.outcomeNote}</p>}
      </div>

      {!step ? (
        <p className="muted">This agent recorded no steps.</p>
      ) : (
        <div className="replay">
          <nav className="steps" aria-label="Steps">
            {steps.map((s, i) => (
              <Link key={s.index} href={href(i)} aria-current={i === at ? "step" : undefined} scroll={false}>
                <span className="idx">{i + 1}</span>
                <span className="what">{describeAction(s.action, s.observation)}</span>
                <span className="path">{pathOf(s.url)}</span>
                {(s.error || s.blocked || findingsAt[s.index]) && (
                  <span className="flag row">
                    {s.error && <span className="chip bad">Failed</span>}
                    {s.blocked && <span className="chip warn">Blocked</span>}
                    {findingsAt[s.index]?.map((f) => (
                      <span key={f.title} className={`chip ${f.class === "real" ? "warn" : ""}`}>
                        Finding
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            ))}
          </nav>

          <div className="stage">
            <div className="pager">
              <Link className="button" href={prev ?? "#"} aria-disabled={!prev} scroll={false}>
                ← Previous
              </Link>
              <span className="small muted num">
                Step {at + 1} of {steps.length}
              </span>
              <Link className="button" href={next ?? "#"} aria-disabled={!next} scroll={false}>
                Next →
              </Link>
              <span className="small faint keys-hint">Arrow keys work too</span>
            </div>

            <div className="shot">
              {shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot} alt={`What ${agent.name} saw on ${pathOf(step.url)} at step ${at + 1}`} />
              ) : (
                <p className="none">No screenshot kept for this step (older than the retention, or not recorded).</p>
              )}
            </div>

            <div className="panel">
              <dl>
                <dt>Page</dt>
                <dd>
                  <code>{pathOf(step.url)}</code> {step.title && <span className="muted">· {step.title}</span>}
                </dd>
                <dt>Did</dt>
                <dd>{describeAction(step.action, step.observation)}</dd>
                <dt>Why</dt>
                <dd>{step.reasoning || <span className="faint">No reason given</span>}</dd>
                {(step.error || step.blocked || after) && <dt>Then</dt>}
                {(step.error || step.blocked || after) && (
                  <dd>
                    {step.error && <span className="chip bad">Failed: {step.error}</span>} {step.blocked && <span className="chip warn">Blocked: {step.blocked}</span>}{" "}
                    {!step.error && !step.blocked && after}
                  </dd>
                )}
                {httpErrors.length > 0 && <dt>Errors</dt>}
                {httpErrors.length > 0 && <dd>{httpErrors.join(" · ")}</dd>}
              </dl>
            </div>

            {findingsAt[step.index] && (
              <div className="panel">
                <h3>Findings from this step</h3>
                {findingsAt[step.index].map((f) => (
                  <div key={f.title} className="row">
                    {f.class === "real" ? <SeverityChip severity={f.severity} /> : <span className="chip">{f.class === "env" ? "Test environment" : "Doubtful"}</span>}
                    <span>{f.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <StepKeys prev={prev} next={next} />
        </div>
      )}
    </>
  );
}
