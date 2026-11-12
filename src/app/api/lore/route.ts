import { NextResponse } from "next/server";
import { getCreatorContextFromRequest } from "@/lib/server/creator-auth";
import { isSupabaseConfigured, listLore } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const creator = await getCreatorContextFromRequest(request);
    if (!creator && isSupabaseConfigured()) {
      return NextResponse.json({ error: "Connect Twitch to view this creator's private lorebook." }, { status: 401 });
    }
    const entries = await listLore(creator?.channelId ?? "demo-channel");
    return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
