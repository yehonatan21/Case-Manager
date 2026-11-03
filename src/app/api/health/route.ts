import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db";
import { aiProviderName } from "@/lib/ai";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await dbHealthy();
  return NextResponse.json(
    { ok: db, db, ai: aiProviderName(), payments: env.paymentProvider, storage: env.storageProvider, email: env.emailProvider },
    { status: db ? 200 : 503 },
  );
}
