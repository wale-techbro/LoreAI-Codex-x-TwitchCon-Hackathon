import { NextResponse } from "next/server";
import { getCreatorContextFromRequest } from "@/lib/server/creator-auth";
import { isSupabaseConfigured, setLoreStatus } from "@/lib/server/store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const creator = await getCreatorContextFromRequest(request);
    if (!creator && isSupabaseConfigured()) {
      return NextResponse.json({ error: "Connect the creator account that owns this lorebook." }, { status: 401 });
    }
    const channelId = creator?.channelId ?? "demo-channel";
    const body = await request.json() as { status?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "Status must be approved or rejected." }, { status: 400 });
    }
    const { id } = await context.params;
    const entry = await setLoreStatus(channelId, id, body.status);
    if (!entry) return NextResponse.json({ error: "Lore entry not found." }, { status: 404 });
    return NextResponse.json({ entry }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update lore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
