import { NoRuns, NotConnected } from "../../../components/Empty";
import { dbConfigured, getDb, schemaReady } from "../../../lib/db";
import { appLabel, money } from "../../../lib/format";
import { spendByDay } from "../../../lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spend" };

// Categorical colours for apps; validated for contrast on both themes' surfaces.
const APP_COLOURS = ["#0f6b74", "#c0661e", "#5b5fc7", "#2e8b57", "#b8457a", "#7a6a1f"];
const DAYS = 30;

export default async function Spend() {
  if (!dbConfigured()) return <NotConnected />;
  if (!(await schemaReady())) return <NoRuns />;
  const now = new Date();
  const days = await spendByDay(getDb(), DAYS, now);
  if (!days.length) return <NoRuns />;

  const apps = [...new Set(days.map((d) => d.app))].sort();
  const colour = (app: string) => APP_COLOURS[apps.indexOf(app) % APP_COLOURS.length];
  const calendar = Array.from({ length: DAYS }, (_, i) => new Date(now.getTime() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const perDay = calendar.map((day) => ({ day, items: days.filter((d) => d.day === day) }));
  const max = Math.max(0.0001, ...perDay.map((d) => d.items.reduce((n, i) => n + i.costUsd, 0)));
  const month = now.toISOString().slice(0, 7);
  const monthTotal = days.filter((d) => d.day.startsWith(month)).reduce((n, d) => n + d.costUsd, 0);
  const total = days.reduce((n, d) => n + d.costUsd, 0);
  const byApp = apps.map((app) => ({
    app,
    cost: days.filter((d) => d.app === app).reduce((n, d) => n + d.costUsd, 0),
    runs: days.filter((d) => d.app === app).reduce((n, d) => n + d.runs, 0),
  }));

  return (
    <>
      <div className="page-head">
        <h1>Spend</h1>
        <p className="sub">What the agents&apos; AI model cost, as each run recorded it. Last {DAYS} days.</p>
      </div>
      <div className="stats">
        <div className="stat">
          <span className="label">This month</span>
          <span className="value">{money(monthTotal)}</span>
        </div>
        <div className="stat">
          <span className="label">Last {DAYS} days</span>
          <span className="value">{money(total)}</span>
        </div>
        {byApp.map((a) => (
          <div className="stat" key={a.app}>
            <span className="label">{appLabel(a.app)}</span>
            <span className="value">{money(a.cost)}</span>
            <span className="small muted num">{a.runs} runs</span>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="legend">
          {apps.map((a) => (
            <span key={a} style={{ ["--c" as string]: colour(a) }}>
              {appLabel(a)}
            </span>
          ))}
        </div>
        <div className="bars" role="img" aria-label={`Daily spend for the last ${DAYS} days, highest ${money(max)}`}>
          {perDay.map((d) => (
            <div className="day" key={d.day} title={`${d.day}: ${d.items.map((i) => `${appLabel(i.app)} ${money(i.costUsd)}`).join(", ") || "nothing"}`}>
              {d.items.map((i) => (
                <div key={i.app} style={{ height: `${(i.costUsd / max) * 150}px`, background: colour(i.app), minHeight: i.costUsd > 0 ? 2 : 0 }} />
              ))}
            </div>
          ))}
        </div>
        <div className="row small faint" style={{ justifyContent: "space-between" }}>
          <span>{calendar[0]}</span>
          <span>{calendar.at(-1)}</span>
        </div>
      </section>
    </>
  );
}
