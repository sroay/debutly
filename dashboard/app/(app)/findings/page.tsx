import Link from "next/link";
import { SeverityChip, When } from "../../../components/Bits";
import { NoRuns, NotConnected } from "../../../components/Empty";
import { dbConfigured, getDb, schemaReady } from "../../../lib/db";
import { appLabel } from "../../../lib/format";
import { appsOverview, findingHistory, type FindingHistory } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Findings" };

const STATUS: Record<FindingHistory["status"], { label: string; tone: string; hint: string }> = {
  new: { label: "New", tone: "info", hint: "First seen in the latest run" },
  recurring: { label: "Recurring", tone: "warn", hint: "In the latest run and earlier ones" },
  absent: { label: "Not in latest run", tone: "good", hint: "The latest run of this app didn't hit it: fixed, or not reached" },
};

type Show = "bugs" | "all";

export default async function Findings(props: { searchParams: Promise<{ app?: string; show?: string }> }) {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const { app, show: showParam } = await props.searchParams;
  const show: Show = showParam === "all" ? "all" : "bugs";
  const db = getDb();
  const [apps, history] = await Promise.all([appsOverview(db, 1), findingHistory(db, { app })]);
  if (!apps.length) return <NoRuns />;
  const shown = show === "all" ? history : history.filter((h) => h.class === "real");
  const link = (o: { app?: string; show?: Show }) => {
    const q = new URLSearchParams();
    const a = "app" in o ? o.app : app;
    const s = o.show ?? show;
    if (a) q.set("app", a);
    if (s === "all") q.set("show", "all");
    return `/findings${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <div className="page-head">
        <h1>Findings</h1>
        <p className="sub">Everything the agents found, across runs: whether the latest run still has it, and how often it turns up.</p>
      </div>
      <div className="row">
        <nav className="filters" aria-label="Filter by app">
          <Link href={link({ app: undefined })} aria-current={!app ? "true" : undefined}>
            All apps
          </Link>
          {apps.map((a) => (
            <Link key={a.app} href={link({ app: a.app })} aria-current={app === a.app ? "true" : undefined}>
              {appLabel(a.app)}
            </Link>
          ))}
        </nav>
        <nav className="filters" aria-label="Which findings">
          <Link href={link({ show: "bugs" })} aria-current={show === "bugs" ? "true" : undefined}>
            Bugs in the apps
          </Link>
          <Link href={link({ show: "all" })} aria-current={show === "all" ? "true" : undefined}>
            Include doubtful and test environment
          </Link>
        </nav>
      </div>

      {shown.length === 0 ? (
        <p className="muted">Nothing found.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Finding</th>
                <th>App</th>
                <th>Now</th>
                <th>Seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={`${f.app}:${f.signature}`}>
                  <td>
                    <div className="row">
                      {f.class === "real" ? <SeverityChip severity={f.severity} /> : <span className="chip">{f.class === "env" ? "Test environment" : "Doubtful"}</span>}
                      <Link href={`/runs/${f.lastRunId}`}>{f.title}</Link>
                    </div>
                    <div className="small muted">
                      on <code>{f.pagePath}</code>
                    </div>
                  </td>
                  <td>{appLabel(f.app)}</td>
                  <td>
                    <span className={`chip ${STATUS[f.status].tone}`} title={STATUS[f.status].hint}>
                      {STATUS[f.status].label}
                    </span>
                  </td>
                  <td className="num">
                    {f.runsSeen} of {f.runsSince} runs
                  </td>
                  <td>
                    <When date={f.lastSeen} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
