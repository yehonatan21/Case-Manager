import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { decryptBuffer, encryptBuffer } from "../crypto";

export interface StorageDriver {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Temporary direct-download URL when the backend supports it (S3); null means stream via the app. */
  signedUrl(key: string, filename: string, mimeType: string): Promise<string | null>;
}

/** Local disk, encrypted at rest with AES-256-GCM (key derived from APP_SECRET). */
export class LocalStorage implements StorageDriver {
  private root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.storageDir);
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.file(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, encryptBuffer(data));
  }
  async get(key: string) {
    return decryptBuffer(await fs.readFile(this.file(key)));
  }
  async signedUrl() {
    return null;
  }
}

/** S3-compatible object storage with server-side encryption and short-lived presigned downloads. */
export class S3Storage implements StorageDriver {
  private clientPromise = (async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      forcePathStyle: !!env.s3Endpoint,
      credentials: env.s3AccessKeyId ? { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey } : undefined,
    });
  })();
  async put(key: string, data: Buffer, mimeType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await client.send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: data, ContentType: mimeType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    const res = await client.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async signedUrl(key: string, filename: string, mimeType: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.clientPromise;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
      { expiresIn: 60 },
    );
  }
}

/** Vercel Blob (private store). Contents are additionally encrypted by the app and served through it. */
export class VercelBlobStorage implements StorageDriver {
  async put(key: string, data: Buffer) {
    const { put } = await import("@vercel/blob");
    await put(key, encryptBuffer(data), { access: "private", addRandomSuffix: false, contentType: "application/octet-stream" });
  }
  async get(key: string) {
    const { get } = await import("@vercel/blob");
    const res = await get(key, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) throw new Error("Blob not found");
    return decryptBuffer(Buffer.from(await new Response(res.stream).arrayBuffer()));
  }
  async signedUrl() {
    return null;
  }
}

/** Encrypted contents in PostgreSQL — for hosts without a persistent disk (fine for MVP-scale volumes). */
export class DatabaseStorage implements StorageDriver {
  private async db() {
    const { getDb } = await import("../db");
    return getDb();
  }
  async put(key: string, data: Buffer) {
    const { fileBlobs } = await import("../db/schema");
    await (await this.db()).insert(fileBlobs).values({ key, data: encryptBuffer(data) });
  }
  async get(key: string) {
    const { fileBlobs } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await (await this.db()).select().from(fileBlobs).where(eq(fileBlobs.key, key));
    if (!row) throw new Error("File not found");
    return decryptBuffer(row.data);
  }
  async signedUrl() {
    return null;
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    driver =
      env.storageProvider === "s3"
        ? new S3Storage()
        : env.storageProvider === "vercel-blob"
          ? new VercelBlobStorage()
          : env.storageProvider === "database"
            ? new DatabaseStorage()
            : new LocalStorage();
  }
  return driver;
}
