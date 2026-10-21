import { authMode } from "../../lib/auth";
import { signIn } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function Login(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await props.searchParams;
  const mode = authMode();
  return (
    <main>
      <form className="login" action={signIn}>
        <h1>Debutly</h1>
        {mode === "unconfigured" ? (
          <p className="error">
            This dashboard has no password yet. Set <code>DASHBOARD_PASSWORD</code> where it is hosted, then reload.
          </p>
        ) : (
          <>
            <label>
              Password
              <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
            </label>
            <input type="hidden" name="next" value={next ?? "/"} />
            {error && <p className="error">That password isn&apos;t right.</p>}
            <button className="button primary" type="submit">
              Sign in
            </button>
          </>
        )}
      </form>
    </main>
  );
}
