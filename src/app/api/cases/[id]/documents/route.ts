import { z } from "zod";
import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { requestDocument, uploadCaseDocument } from "@/lib/services/documents";
import { MAX_ITEMS_PER_REQUEST, requestDocuments, requestTemplateDocuments } from "@/lib/services/checklists";
import { AppError } from "@/lib/errors";
import { isStaffRole } from "@/lib/domain";

const Item = z.object({ title: z.string().min(1).max(200), note: z.string().max(2000).nullish(), required: z.boolean().optional() });
const RequestBody = z.union([
  z.object({ templateId: z.uuid(), only: z.array(z.number().int().min(0).max(100)).max(MAX_ITEMS_PER_REQUEST).optional() }),
  z.object({ items: z.array(Item).min(1).max(MAX_ITEMS_PER_REQUEST) }),
  z.object({ title: z.string().min(1).max(200), note: z.string().max(2000).nullish() }),
]);

/** Upload a file (multipart) or, for staff, request a document from the client (JSON). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const db = await getDb();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    if (!isStaffRole(user.role)) throw new AppError("forbidden");
    const parsed = RequestBody.safeParse(await req.json());
    if (!parsed.success) throw new AppError("validation");
    const b = parsed.data;
    // A service template's checklist, a list of documents, or a single document.
    if ("templateId" in b) return ok({ created: (await requestTemplateDocuments(db, user, id, b.templateId, b.only)).length });
    if ("items" in b) return ok({ created: (await requestDocuments(db, user, id, b.items)).length });
    const d = await requestDocument(db, user, id, b);
    return ok({ id: d.id, created: 1 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("validation");
  const documentId = (form.get("documentId") as string) || null;
  const visibility = form.get("visibility") === "internal" ? "internal" : "client";
  const res = await uploadCaseDocument(db, user, id, {
    file: { name: file.name, data: Buffer.from(await file.arrayBuffer()) },
    documentId,
    title: (form.get("title") as string) || null,
    visibility,
  });
  return ok({ documentId: res.document.id, fileId: res.file.id });
});
