import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createCreatorSession, CREATOR_SESSION_COOKIE, CREATOR_SESSION_TTL_SECONDS } from "@/lib/server/creator-auth";
import { exchangeTwitchAuthorizationCode } from "@/lib/server/twitch-oauth";

export const runtime = "nodejs";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateCookie = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith("lore_oauth_state="))?.slice("lore_oauth_state=".length);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const oauthError = url.searchParams.get("error");
  const redirectHome = (connect?: string) => {
    const target = new URL("/", url.origin);
    if (connect) target.searchParams.set("connect", connect);
    const response = NextResponse.redirect(target);
    response.cookies.set("lore_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/twitch", maxAge: 0 });
    return response;
  };

  if (oauthError) {
    return redirectHome("denied");
  }
  if (!stateCookie || !state || !safeEqual(stateCookie, state) || !code) {
    return redirectHome("invalid");
  }

  try {
    const { account } = await exchangeTwitchAuthorizationCode(code);
    const session = await createCreatorSession(account.accountId);
    const success = NextResponse.redirect(new URL("/", url.origin));
    success.cookies.set("lore_oauth_state", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/twitch", maxAge: 0 });
    success.cookies.set(CREATOR_SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CREATOR_SESSION_TTL_SECONDS
    });
    success.headers.set("Cache-Control", "no-store");
    return success;
  } catch {
    return redirectHome("failed");
  }
}
