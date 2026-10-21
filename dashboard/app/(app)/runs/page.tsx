import Link from "next/link";
import { FindingCountChips, When } from "../../../components/Bits";
import { NoRuns, NotConnected } from "../../../components/Empty";
import { dbConfigured, getDb, schemaReady } from "../../../lib/db";
import { appLabel, money, triggerLabel } from "../../../lib/format";
import { appsOverview, listRuns } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

export default async function Runs(props: { searchParams: Promise<{ app?: string }> }) {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const { app } = await props.searchParams;
  const db = getDb();
  const [apps, runs] = await Promise.all([appsOverview(db, 1), listRuns(db, { app, limit: 100 })]);
  if (!apps.length) return <NoRuns />;

  return (
    <>
      <div className="page-head">
        <h1>{app ? `${appLabel(app)} runs` : "Runs"}</h1>
        <p className="sub">Every run the agents made, newest first.</p>
      </div>
      <nav className="filters" aria-label="Filter by app">
        <Link href="/runs" aria-current={!app ? "true" : undefined}>
          All apps
        </Link>
        {apps.map((a) => (
          <Link key={a.app} href={`/runs?app=${encodeURIComponent(a.app)}`} aria-current={app === a.app ? "true" : undefined}>
            {appLabel(a.app)}
          </Link>
        ))}
      </nav>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>App</th>
              <th>Started by</th>
              <th>Agents finished</th>
              <th>Findings</th>
              <th>Cost</th>
              <th>CI</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/runs/${r.id}`}>
                    <When date={r.createdAt} />
                  </Link>
                </td>
                <td>{appLabel(r.app)}</td>
                <td>{triggerLabel(r.trigger)}</td>
                <td className="num">
                  {r.succeeded} of {r.agents}
                </td>
                <td>
                  <FindingCountChips counts={r.findings} />
                </td>
                <td className="num">{money(r.costUsd)}</td>
                <td>{r.ciUrl ? <a href={r.ciUrl}>GitHub</a> : <span className="faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
