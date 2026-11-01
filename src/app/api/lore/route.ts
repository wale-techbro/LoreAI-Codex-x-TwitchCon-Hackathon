import { NextResponse } from "next/server";
import { listLore } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ entries: await listLore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load lore.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
