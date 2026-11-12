import { NextResponse } from "next/server";
import { getCreatorContextFromRequest } from "@/lib/server/creator-auth";
import { getStatus } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const [status, creator] = await Promise.all([getStatus(), getCreatorContextFromRequest(request)]);
    return NextResponse.json({
      ...status,
      creatorConnected: Boolean(creator),
      creatorLogin: creator?.twitchLogin ?? null,
      channelLogin: creator?.channelLogin ?? null
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service configuration is incomplete.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
