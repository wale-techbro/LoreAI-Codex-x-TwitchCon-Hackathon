import { NextResponse } from "next/server";
import {
  ADMIN_SECRET_MIN_LENGTH,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  adminSecretMatches,
  createAdminSessionToken,
  getAdminAccess,
  getAdminAccessFromCookieHeader
} from "@/lib/server/moderation-auth";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS
  };
}

export async function GET(request: Request) {
  return json(getAdminAccessFromCookieHeader(request.headers.get("cookie")));
}

export async function POST(request: Request) {
  const secret = process.env.LORE_ADMIN_SECRET?.trim() ?? "";
  if (secret.length < ADMIN_SECRET_MIN_LENGTH) {
    if (!secret && process.env.NODE_ENV !== "production") return json(getAdminAccess(null));
    return json({ error: "Configure LORE_ADMIN_SECRET with at least 32 characters before enabling moderation." }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a valid JSON request." }, 400);
  }

  if (typeof body !== "object" || body === null || !("secret" in body) || typeof body.secret !== "string") {
    return json({ error: "Enter the streamer moderation secret." }, 400);
  }
  if (!adminSecretMatches(body.secret, secret)) {
    return json({ error: "The moderation secret is incorrect." }, 401);
  }

  const response = json({ configured: true, authorized: true });
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, createAdminSessionToken(secret), cookieOptions());
  return response;
}

export async function DELETE() {
  const response = json(getAdminAccess(null));
  response.cookies.set(ADMIN_SESSION_COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
  return response;
}
