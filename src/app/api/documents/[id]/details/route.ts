import { z } from "zod";
import { route, readJson, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiStaff } from "@/lib/auth/session";
import { updateDocumentDetails } from "@/lib/services/documents";

const s = (max: number) => z.string().max(max).optional();
const day = z.union([z.iso.date(), z.literal("")]).optional();

/** Staff save (and so confirm) a document's key details. */
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiStaff();
  const body = await readJson(req, z.object({ docType: s(80), fullName: s(160), idNumber: s(40), birthDate: day, issueDate: day, expiryDate: day }));
  return ok({ details: await updateDocumentDetails(await getDb(), user, id, body) });
});
