"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, AUTH_MAX_AGE_S, passwordMatches, safeNext, sessionToken } from "../../lib/auth";

export async function signIn(form: FormData) {
  const next = safeNext(form.get("next"));
  if (!passwordMatches(String(form.get("password") ?? ""))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(AUTH_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE_S,
  });
  redirect(next);
}
