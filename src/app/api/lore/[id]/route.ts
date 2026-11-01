import { NextResponse } from "next/server";
import { setLoreStatus } from "@/lib/server/store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { status?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "Status must be approved or rejected." }, { status: 400 });
    }
    const { id } = await context.params;
    const entry = await setLoreStatus(id, body.status);
    if (!entry) return NextResponse.json({ error: "Lore entry not found." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update lore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
