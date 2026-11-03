import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizeDownload } from "@/lib/services/documents";
import { storage } from "@/lib/storage";
import { readOwnerToken } from "../../intake/_owner";

/** Permission-checked, audited download. S3 redirects to a 60-second presigned URL; local storage streams. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const file = await authorizeDownload(await getDb(), await getCurrentUser(), await readOwnerToken(), id);
  const inline = new URL(req.url).searchParams.get("inline") === "1" && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf");
  const signed = await storage().signedUrl(file.storageKey, file.filename, file.mimeType);
  if (signed) return NextResponse.redirect(signed);
  const data = await storage().get(file.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
