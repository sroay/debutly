import Link from "next/link";
import { FindingCountChips, OutcomeChip, SeverityChip, Trend, When } from "../../components/Bits";
import { NoRuns, NotConnected } from "../../components/Empty";
import { dbConfigured, getDb, schemaReady } from "../../lib/db";
import { appLabel, money, triggerLabel } from "../../lib/format";
import { appsOverview, findingHistory, spendByDay } from "../../lib/queries";

export const dynamic = "force-dynamic";

export default async function Overview() {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const db = getDb();
  const [apps, history, spend] = await Promise.all([appsOverview(db), findingHistory(db), spendByDay(db, 31)]);
  if (!apps.length) return <NoRuns />;

  const month = new Date().toISOString().slice(0, 7);
  const monthSpend = spend.filter((d) => d.day.startsWith(month)).reduce((n, d) => n + d.costUsd, 0);
  const open = history.filter((h) => h.class === "real" && h.status !== "absent");

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <p className="sub">
          {apps.length} apps tested · {money(monthSpend)} spent on agents this month · {open.length} open bugs
        </p>
      </div>

      <section className="grid-apps" aria-label="Apps">
        {apps.map(({ app, latest, recent }) => (
          <article className="card" key={app}>
            <div className="card-head">
              <h2>
                <Link href={`/runs?app=${encodeURIComponent(app)}`}>{appLabel(app)}</Link>
              </h2>
              <span className="small muted">
                {triggerLabel(latest.trigger)} · <When date={latest.createdAt} />
              </span>
            </div>
            <div className="stats">
              <div className="stat">
                <span className="label">Agents finished</span>
                <span className="value">
                  {latest.succeeded}/{latest.agents}
                </span>
              </div>
              <div className="stat">
                <span className="label">Last run cost</span>
                <span className="value">{money(latest.costUsd)}</span>
              </div>
            </div>
            <div className="row">
              {Object.entries(latest.outcomes)
                .filter(([o]) => o !== "success")
                .map(([o, n]) => (
                  <span key={o} className="row small">
                    {n} × <OutcomeChip outcome={o} />
                  </span>
                ))}
            </div>
            <FindingCountChips counts={latest.findings} />
            <div className="section">
              <span className="small muted">Last {recent.length} runs</span>
              <Trend runs={recent} />
            </div>
            <Link className="button" href={`/runs/${latest.id}`}>
              Open the latest run
            </Link>
          </article>
        ))}
      </section>

      <section className="section">
        <div className="section-title">
          <h2>Open bugs</h2>
          <Link href="/findings" className="small">
            All findings
          </Link>
        </div>
        {open.length === 0 ? (
          <p className="muted">The latest runs found nothing wrong in the apps themselves.</p>
        ) : (
          <div className="list">
            {open.slice(0, 8).map((f) => (
              <div key={`${f.app}:${f.signature}`} className={`finding ${f.severity}`}>
                <div className="body">
                  <div className="row">
                    <SeverityChip severity={f.severity} />
                    <span className="chip">{appLabel(f.app)}</span>
                    {f.status === "new" && <span className="chip info">New</span>}
                    <Link href={`/runs/${f.lastRunId}`}>
                      <strong>{f.title}</strong>
                    </Link>
                  </div>
                  <span className="small muted">
                    Seen in {f.runsSeen} of the last {f.runsSince} runs · first <When date={f.firstSeen} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
