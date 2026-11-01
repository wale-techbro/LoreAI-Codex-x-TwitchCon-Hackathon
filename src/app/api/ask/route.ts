import { NextResponse } from "next/server";
import { answerFromLore } from "@/lib/server/answer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: unknown };
    if (typeof body.question !== "string" || body.question.trim().length === 0) {
      return NextResponse.json({ error: "Ask a question about this community." }, { status: 400 });
    }
    if (body.question.length > 400) return NextResponse.json({ error: "Questions must be 400 characters or less." }, { status: 400 });
    return NextResponse.json(await answerFromLore(body.question.trim()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "LORE couldn't answer just now.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
