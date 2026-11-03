import { ALLOWED_UPLOAD_TYPES } from "../domain";
import { AppError } from "../errors";
import { env } from "../env";

function startsWith(buf: Buffer, bytes: number[], offset = 0) {
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Validates size, extension and magic bytes. Returns the canonical MIME type. */
export function validateUpload(filename: string, buf: Buffer): string {
  if (buf.length === 0) throw new AppError("validation", "Empty file");
  if (buf.length > env.maxUploadBytes) throw new AppError("file_too_large");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = Object.entries(ALLOWED_UPLOAD_TYPES).find(([, exts]) => exts.includes(ext))?.[0];
  if (!mime) throw new AppError("file_type_not_allowed");

  const ok = (() => {
    switch (ext) {
      case "pdf":
        return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
      case "png":
        return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
      case "jpg":
      case "jpeg":
        return startsWith(buf, [0xff, 0xd8, 0xff]);
      case "gif":
        return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
      case "webp":
        return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString() === "WEBP";
      case "heic":
        return buf.subarray(4, 8).toString() === "ftyp";
      case "docx":
      case "xlsx":
        return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
      case "doc":
      case "xls":
        return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
      case "txt":
        return !buf.subarray(0, 4096).includes(0);
      default:
        return false;
    }
  })();
  if (!ok) throw new AppError("file_type_not_allowed", "File content does not match its extension");
  return mime;
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  return (cleaned || "file").slice(0, 180);
}
