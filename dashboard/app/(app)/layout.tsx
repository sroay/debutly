import Link from "next/link";
import type { ReactNode } from "react";
import { authMode } from "../../lib/auth";
import { Nav } from "../../components/Nav";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M5 11h14a3 3 0 1 0-3-3M5 16h20a3 3 0 1 1-3 3M5 21h10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            Debutly
          </Link>
          <Nav />
          <span className="spacer" />
          {authMode() === "password" && (
            <form action={signOut}>
              <button className="signout" type="submit">
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
