import { NextResponse } from "next/server";
import { CREATOR_SESSION_COOKIE, getCreatorContextFromRequest, revokeAllCreatorSessions } from "@/lib/server/creator-auth";
import { disconnectTwitchCreator, getCreatorTokenRecord } from "@/lib/server/creator-store";
import { decryptTwitchToken } from "@/lib/server/token-crypto";
import { revokeTwitchAccessToken } from "@/lib/server/twitch-oauth";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const creator = await getCreatorContextFromRequest(request);
    if (!creator) return NextResponse.json({ error: "Connect Twitch before disconnecting." }, { status: 401 });
    const tokens = await getCreatorTokenRecord(creator.accountId);
    if (tokens) await revokeTwitchAccessToken(decryptTwitchToken(tokens.accessTokenEncrypted));
    await disconnectTwitchCreator(creator.accountId);
    await revokeAllCreatorSessions(creator.accountId);
    const response = NextResponse.json({ disconnected: true });
    response.cookies.set(CREATOR_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Could not disconnect Twitch. The existing connection was left in place." }, { status: 503 });
  }
}
