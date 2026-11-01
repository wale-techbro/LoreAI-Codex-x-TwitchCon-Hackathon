import { NextResponse } from "next/server";
import { getStatus } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Service configuration is incomplete.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
