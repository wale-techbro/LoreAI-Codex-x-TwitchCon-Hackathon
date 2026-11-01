import { NextResponse } from "next/server";
import { getAdminAccessFromCookieHeader, visibleLoreEntries } from "@/lib/server/moderation-auth";
import { listLore } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const entries = await listLore();
    const { authorized } = getAdminAccessFromCookieHeader(request.headers.get("cookie"));
    const visibleEntries = visibleLoreEntries(entries, authorized);
    return NextResponse.json({ entries: visibleEntries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
