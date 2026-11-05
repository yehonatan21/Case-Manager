import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { safeEqual } from "@/lib/crypto";
import { whatsappProvider } from "@/lib/whatsapp";
import { getWhatsAppConfig, handleWhatsAppWebhook } from "@/lib/services/whatsapp";

/** Meta's one-time check when the webhook is set up: echo hub.challenge if the verify token matches. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = await getWhatsAppConfig(await getDb());
  const token = url.searchParams.get("hub.verify_token") ?? "";
  if (!cfg?.verifyToken || url.searchParams.get("hub.mode") !== "subscribe" || !safeEqual(token, cfg.verifyToken)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
}

/** Incoming messages and delivery updates, signed with the app secret (X-Hub-Signature-256). */
export async function POST(req: Request) {
  const db = await getDb();
  const cfg = await getWhatsAppConfig(db);
  if (!cfg) return NextResponse.json({ ok: false, error: { code: "not_found" } }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ ok: false, error: { code: "validation" } }, { status: 413 });
  if (!whatsappProvider(cfg).verifySignature(raw, req.headers)) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Bad signature" } }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: { code: "validation" } }, { status: 400 });
  }
  try {
    const res = await handleWhatsAppWebhook(db, cfg, payload);
    return NextResponse.json({ ok: true, data: res });
  } catch (err) {
    // 500 makes WhatsApp retry later; duplicates are skipped by message id.
    console.error("[whatsapp] webhook failed", err);
    return NextResponse.json({ ok: false, error: { code: "server_error" } }, { status: 500 });
  }
}
