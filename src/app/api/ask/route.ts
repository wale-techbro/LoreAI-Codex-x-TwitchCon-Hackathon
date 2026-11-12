import { NextResponse } from "next/server";
import { getCreatorContextFromRequest, getPublicChannelByLogin } from "@/lib/server/creator-auth";
import { answerFromLore } from "@/lib/server/answer";
import { isSupabaseConfigured } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: unknown; channel_login?: unknown };
    if (typeof body.question !== "string" || body.question.trim().length === 0) {
      return NextResponse.json({ error: "Ask a question about this community." }, { status: 400 });
    }
    if (body.question.length > 400) return NextResponse.json({ error: "Questions must be 400 characters or less." }, { status: 400 });

    const creator = await getCreatorContextFromRequest(request);
    let channelId = creator?.channelId;
    if (!channelId && typeof body.channel_login === "string") {
      channelId = (await getPublicChannelByLogin(body.channel_login))?.id;
    }
    if (!channelId && !isSupabaseConfigured()) channelId = "demo-channel";
    if (!channelId) return NextResponse.json({ error: "Choose a connected creator channel to ask about its lore." }, { status: 404 });

    const result = await answerFromLore(channelId, body.question.trim());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LORE couldn't answer just now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
