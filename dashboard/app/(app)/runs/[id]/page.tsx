import Link from "next/link";
import { notFound } from "next/navigation";
import { FindingCountChips, FindingItem, OutcomeChip, When } from "../../../../components/Bits";
import { NoRuns, NotConnected } from "../../../../components/Empty";
import { dbConfigured, getDb, schemaReady } from "../../../../lib/db";
import { appLabel, money, needLabel, triggerLabel } from "../../../../lib/format";
import { listRuns, runDetail, type RunDetail } from "../../../../lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Run" };

type Agent = RunDetail["agents"][number];

function Member({ runId, a }: { runId: string; a: Agent }) {
  return (
    <div className="member">
      <div className="row">
        <Link href={`/runs/${runId}/agents/${a.id}`}>
          <strong>{a.name}</strong>
        </Link>
        {a.role && <span className="muted small">{a.role}</span>}
        {a.inclusion && <span className="chip">{needLabel(a.inclusion)}</span>}
      </div>
      <div className="row">
        <OutcomeChip outcome={a.outcome} />
        <span className="small muted num">{a.steps} steps</span>
      </div>
      {a.outcomeNote && a.outcome !== "success" && <p className="note">{a.outcomeNote}</p>}
    </div>
  );
}

export default async function Run(props: { params: Promise<{ id: string }> }) {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const detail = await runDetail(db, id);
  if (!detail) notFound();
  const { run, units, agents, findings } = detail;
  const [summary] = await listRuns(db, { id: run.id, limit: 1 });
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const real = findings.filter((f) => f.class === "real");
  const doubtful = findings.filter((f) => f.class === "low");
  const env = findings.filter((f) => f.class === "env");
  const crews = units.filter((u) => u.kind === "business");
  const individuals = agents.filter((a) => !crews.some((u) => u.id === a.unitId));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          {appLabel(run.app ?? "(no app)")} · {triggerLabel(run.trigger)} run
        </span>
        <h1>
          <When date={run.createdAt} />
        </h1>
        <p className="sub">{run.goal}</p>
        <div className="row small muted">
          <span>Cost {money(run.costUsd)}</span>
          {run.model && <span>· {run.model}</span>}
          {run.ciUrl && (
            <span>
              · <a href={run.ciUrl}>GitHub Actions run</a>
            </span>
          )}
          {summary && (
            <span>
              · {summary.succeeded} of {summary.agents} agents finished
            </span>
          )}
        </div>
        {summary && <FindingCountChips counts={summary.findings} />}
      </div>

      {crews.length > 0 && (
        <section className="section">
          <h2>Businesses</h2>
          <div className="grid-apps">
            {crews.map((u) => (
              <article className="card" key={u.id}>
                <div className="card-head">
                  <h3>{u.business?.name ?? u.id}</h3>
                  {u.business && (
                    <span className="small muted">
                      {u.business.archetype}, ~{u.business.size} people
                    </span>
                  )}
                </div>
                <div className="crew">
                  {agents
                    .filter((a) => a.unitId === u.id)
                    .sort((a, b) => Number(b.id.endsWith("-o")) - Number(a.id.endsWith("-o")))
                    .map((a) => (
                      <Member key={a.id} runId={run.id} a={a} />
                    ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {individuals.length > 0 && (
        <section className="section">
          <h2>{crews.length ? "Other agents" : "Agents"}</h2>
          <div className="card crew">
            {individuals.map((a) => (
              <Member key={a.id} runId={run.id} a={a} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Bugs in the app</h2>
        {real.length ? (
          <div className="list">
            {real.map((f) => (
              <FindingItem key={f.signature} f={f} runId={run.id} agentNames={names} />
            ))}
          </div>
        ) : (
          <p className="muted">None found in this run.</p>
        )}
      </section>

      {doubtful.length > 0 && (
        <section className="section">
          <h2>Doubtful</h2>
          <p className="muted small">Seen by few of the agents who visited the page: possibly the agent&apos;s own mistake.</p>
          <div className="list">
            {doubtful.map((f) => (
              <FindingItem key={f.signature} f={f} runId={run.id} agentNames={names} />
            ))}
          </div>
        </section>
      )}

      {env.length > 0 && (
        <section className="section">
          <h2>Caused by the test environment</h2>
          <p className="muted small">The test copy blocks outside services and has none of the app&apos;s secret keys, so these probably don&apos;t happen on the real app.</p>
          <div className="list">
            {env.map((f) => (
              <FindingItem key={f.signature} f={f} runId={run.id} agentNames={names} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
