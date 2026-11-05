import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getVapidKeys } from "@/lib/services/push";

export const dynamic = "force-dynamic";

/** The public VAPID key the browser needs to subscribe. Public by design. */
export async function GET() {
  const { publicKey } = await getVapidKeys(await getDb());
  return NextResponse.json({ ok: true, data: { publicKey } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
