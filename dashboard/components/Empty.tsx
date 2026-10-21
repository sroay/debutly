/** No database configured yet: how to connect one. */
export function NotConnected() {
  return (
    <div className="empty">
      <h2>Connect a database</h2>
      <p className="muted">
        The dashboard reads runs from the Postgres the engine records into. Set <code>DATABASE_URL</code> to it (any Postgres: Neon, Supabase, your own) and reload.
      </p>
    </div>
  );
}

/** Connected, but nothing recorded yet: how runs get here. */
export function NoRuns() {
  return (
    <div className="empty">
      <h2>No runs yet</h2>
      <p className="muted">Runs appear here once the engine records them. Pass the same database to a run:</p>
      <pre>npm run debutly -- --url http://localhost:3000 --goal &quot;Sign up&quot; --icp &quot;…&quot; --store &quot;$DATABASE_URL&quot; --app my-app</pre>
      <p className="muted">Or load runs made before, from their report folders or from GitHub Actions:</p>
      <pre>npm run debutly:import -- --store &quot;$DATABASE_URL&quot; --github owner/repo --app my-app</pre>
    </div>
  );
}
