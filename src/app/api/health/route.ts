import { NextResponse } from "next/server";
import { dbHealthy, getDb } from "@/lib/db";
import { activePaymentProvider } from "@/lib/services/payment-settings";
import { aiProviderName } from "@/lib/ai";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await dbHealthy();
  const payments = db ? await activePaymentProvider(await getDb()).catch(() => env.paymentProvider) : env.paymentProvider;
  return NextResponse.json(
    { ok: db, db, ai: aiProviderName(), payments, storage: env.storageProvider, email: env.emailProvider },
    { status: db ? 200 : 503 },
  );
}
