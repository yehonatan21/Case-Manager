import crypto from "node:crypto";
import { WhatsAppError, type InboundEvent, type InboundMessage, type InboundStatus, type WhatsAppConfig, type WhatsAppProvider } from "./index";

/** Error codes Meta documents as temporary (throttling, service unavailable). Everything else is permanent. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/** Hosts WhatsApp serves received files from. The API host itself is allowed too (tests point it at a stand-in). */
const MEDIA_HOSTS = ["fbsbx.com", "facebook.com", "fbcdn.net", "whatsapp.net"];

type MetaError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

export function createMetaProvider(cfg: WhatsAppConfig): WhatsAppProvider {
  const auth = { authorization: `Bearer ${cfg.accessToken}` };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${cfg.apiUrl}/${path}`, { ...init, headers: { ...auth, ...(init.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new WhatsAppError(`WhatsApp unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as T & MetaError;
    if (res.ok && !body.error) return body;
    const e = body.error ?? {};
    const detail = e.error_data?.details ? ` (${e.error_data.details})` : "";
    const transient = res.status >= 500 || res.status === 429 || TRANSIENT_CODES.has(Number(e.code));
    throw new WhatsAppError(`${e.message ?? `HTTP ${res.status}`}${detail}`.slice(0, 300), transient, e.code ?? res.status);
  }

  async function send(payload: Record<string, unknown>) {
    const r = await call<{ messages?: { id: string }[] }>(`${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new WhatsAppError("WhatsApp returned no message id", true);
    return { id };
  }

  const mediaAllowed = (url: string) => {
    try {
      const u = new URL(url);
      if (u.host === new URL(cfg.apiUrl).host) return true;
      return u.protocol === "https:" && MEDIA_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    } catch {
      return false;
    }
  };

  return {
    async verifyCredentials() {
      const r = await call<{ display_phone_number?: string; verified_name?: string }>(`${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`);
      return { displayPhone: r.display_phone_number ?? null, name: r.verified_name ?? null };
    },

    sendTemplate(to, language, params) {
      return send({
        to,
        type: "template",
        template: { name: cfg.template, language: { code: language }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] },
      });
    },

    sendText(to, body) {
      return send({ to, type: "text", text: { preview_url: true, body: body.slice(0, 4096) } });
    },

    async downloadMedia(mediaId) {
      const meta = await call<{ url?: string; mime_type?: string }>(encodeURIComponent(mediaId));
      if (!meta.url || !mediaAllowed(meta.url)) throw new WhatsAppError("Unexpected media URL", false);
      const res = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new WhatsAppError(`Media download failed (${res.status})`, res.status >= 500);
      return { data: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type ?? res.headers.get("content-type") };
    },

    verifySignature(rawBody, headers) {
      const sig = headers.get("x-hub-signature-256") ?? "";
      if (!sig.startsWith("sha256=") || !cfg.appSecret) return false;
      const expected = crypto.createHmac("sha256", cfg.appSecret).update(rawBody, "utf8").digest("hex");
      const a = Buffer.from(sig.slice(7));
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    parseWebhook(payload) {
      const out: InboundEvent = { messages: [], statuses: [] };
      const entries = (payload as { entry?: unknown[] })?.entry;
      if (!Array.isArray(entries)) return out;
      for (const entry of entries as { changes?: { field?: string; value?: Record<string, unknown> }[] }[]) {
        for (const ch of entry.changes ?? []) {
          if (ch.field !== "messages" || !ch.value) continue;
          // Only events for our own number (a Meta app can serve several).
          const meta = ch.value.metadata as { phone_number_id?: string } | undefined;
          if (meta?.phone_number_id && meta.phone_number_id !== cfg.phoneNumberId) continue;
          for (const m of (ch.value.messages as Record<string, any>[] | undefined) ?? []) {
            if (!m?.id || !m?.from) continue;
            const msg: InboundMessage = { id: String(m.id), from: String(m.from).replace(/\D/g, ""), contextId: m.context?.id ? String(m.context.id) : null, text: null, media: null, unsupported: null };
            const type = String(m.type ?? "");
            if (type === "text") msg.text = String(m.text?.body ?? "");
            else if (type === "button") msg.text = String(m.button?.text ?? "");
            else if (type === "interactive") msg.text = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "");
            else if (["image", "document", "audio", "video", "sticker"].includes(type) && m[type]?.id) {
              const f = m[type];
              msg.media = { id: String(f.id), mimeType: f.mime_type ?? null, filename: f.filename ?? null, caption: f.caption ?? null, kind: type };
            } else msg.unsupported = type || "unknown";
            out.messages.push(msg);
          }
          for (const s of (ch.value.statuses as Record<string, any>[] | undefined) ?? []) {
            if (!s?.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
            const err = Array.isArray(s.errors) && s.errors[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : null;
            out.statuses.push({ id: String(s.id), status: s.status as InboundStatus["status"], error: err });
          }
        }
      }
      return out;
    },
  };
}
