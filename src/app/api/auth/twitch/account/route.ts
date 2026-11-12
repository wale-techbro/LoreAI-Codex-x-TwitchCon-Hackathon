import { NextResponse } from "next/server";
import { getCreatorContextFromRequest } from "@/lib/server/creator-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const creator = await getCreatorContextFromRequest(request);
    if (!creator) return NextResponse.json({ connected: false }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({
      connected: true,
      creator: { twitchLogin: creator.twitchLogin, channelLogin: creator.channelLogin, scopes: creator.scopes, connectedAt: creator.connectedAt }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the connected creator." }, { status: 503 });
  }
}
