import { route, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { uploadIntakeAttachment } from "@/lib/services/documents";
import { getCurrentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { readOwnerToken } from "../../_owner";

export const POST = route<{ id: string }>(async (req, { id }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("validation");
  const res = await uploadIntakeAttachment(await getDb(), {
    sessionId: id,
    user: await getCurrentUser(),
    ownerToken: await readOwnerToken(),
    file: { name: file.name, data: Buffer.from(await file.arrayBuffer()) },
  });
  return ok({ documentId: res.document.id, fileId: res.file.id, name: res.file.filename });
});
