import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { REQUIRED_TWITCH_SCOPES } from "@/lib/server/twitch-oauth";

export const runtime = "nodejs";

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const redirectUri = process.env.TWITCH_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Twitch OAuth is not configured. Set TWITCH_CLIENT_ID and TWITCH_REDIRECT_URI." }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: REQUIRED_TWITCH_SCOPES.join(" "),
    state
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("lore_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/twitch",
    maxAge: 10 * 60
  });
  return response;
}
