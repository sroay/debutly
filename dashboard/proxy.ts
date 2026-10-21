import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isSignedIn } from "./lib/auth";

// Everything but the sign-in page (and Next's own assets) needs the dashboard password.
export function proxy(request: NextRequest) {
  if (isSignedIn(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
