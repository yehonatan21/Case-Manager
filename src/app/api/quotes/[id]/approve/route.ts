import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { clientIp, requireApiUser } from "@/lib/auth/session";
import { approveQuote } from "@/lib/services/quotes";
import { decodeSignatureImage, saveSignedQuote, validSignerName } from "@/lib/services/signatures";
import { AppError } from "@/lib/errors";

const Body = z.object({
  confirm: z.boolean(),
  /** The client's electronic signature: full name typed, optionally drawn (PNG data URL). */
  signature: z.object({ name: z.string().max(200), image: z.string().max(450_000).nullish() }).optional(),
});

/**
 * Customer approval of a specific quote version (POST /quotes/:id/approve in the spec). The approval is signed:
 * a signed PDF of the approved version is saved to the case's documents.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const { confirm, signature } = await readJson(req, Body);
  if (!confirm) throw new AppError("validation");
  // Check the signature before approving, so a bad one doesn't leave a half-done approval.
  if (signature && !validSignerName(signature.name)) throw new AppError("signature_name_invalid");
  decodeSignatureImage(signature?.image);
  const db = await getDb();
  const ip = await clientIp();
  const q = await approveQuote(db, user, id, ip);
  await saveSignedQuote(db, user, q, { name: signature?.name ?? null, image: signature?.image ?? null }, { ip, userAgent: req.headers.get("user-agent") });
  return ok({ id: q.id, status: q.status });
});
