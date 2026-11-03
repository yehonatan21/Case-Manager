import { z } from "zod";
import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { requestDocument, uploadCaseDocument } from "@/lib/services/documents";
import { AppError } from "@/lib/errors";
import { isStaffRole } from "@/lib/domain";

/** Upload a file (multipart) or, for staff, request a document from the client (JSON). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const user = await requireApiUser();
  const db = await getDb();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    if (!isStaffRole(user.role)) throw new AppError("forbidden");
    const parsed = z.object({ title: z.string().min(1).max(200), note: z.string().max(2000).nullish() }).safeParse(await req.json());
    if (!parsed.success) throw new AppError("validation");
    const d = await requestDocument(db, user, id, parsed.data);
    return ok({ id: d.id });
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
