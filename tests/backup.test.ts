import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as s from "@/lib/db/schema";
import { createPgliteDatabase } from "@/lib/db";
import { ensureSeed } from "@/lib/db/seed";
import { env } from "@/lib/env";
import { createBackup, readBackup, restoreBackup, tablesInDependencyOrder } from "@/lib/backup";
import { removeDemoData } from "@/lib/services/demo-cleanup";

describe("backups", () => {
  it("restore into a new database gives back exactly the same data, bytes and dates included", async () => {
    const source = await createPgliteDatabase();
    const saved = env.seedDemoData;
    Object.assign(env, { seedDemoData: true });
    try {
      await ensureSeed(source);
    } finally {
      Object.assign(env, { seedDemoData: saved });
    }
    // A stored file (bytes) and a JSON column survive.
    await source.insert(s.fileBlobs).values({ key: "test/file", data: Buffer.from([0, 1, 2, 250, 255]) });
    const { file, meta } = await createBackup(source);
    expect(meta.tables.cases!.rows).toBeGreaterThan(0);
    expect(meta.tables.file_blobs!.rows).toBe(1);
    // Encrypted: the contents aren't readable in the file.
    expect(file.toString("latin1")).not.toContain("example.com");
    expect(readBackup(file).data.users!.length).toBe(meta.tables.users!.rows);

    const target = await createPgliteDatabase();
    const r = await restoreBackup(target, file);
    expect(r.rows).toBe(Object.values(meta.tables).reduce((a, t) => a + t.rows, 0));
    const again = await createBackup(target);
    expect(again.meta.tables).toEqual(meta.tables);
    const [blob] = await target.select().from(s.fileBlobs);
    expect(Buffer.from(blob!.data).equals(Buffer.from([0, 1, 2, 250, 255]))).toBe(true);
    const [c] = await target.select().from(s.cases).limit(1);
    expect(c!.createdAt).toBeInstanceOf(Date);

    // A second restore into the same (no longer empty) database is refused, and a damaged file too.
    await expect(restoreBackup(target, file)).rejects.toThrow(/isn't empty/);
    const damaged = Buffer.from(file);
    damaged[damaged.length - 5]! ^= 0xff;
    await expect(restoreBackup(await createPgliteDatabase(), damaged)).rejects.toThrow(/decrypted/);
    await expect(restoreBackup(await createPgliteDatabase(), Buffer.from("not a backup"))).rejects.toThrow(/not a Case Manager backup/);
    // With BACKUP_SECRET set, only that secret opens the file.
    process.env.BACKUP_SECRET = "first-backup-secret-0123456789abcdef";
    try {
      const own = (await createBackup(source)).file;
      expect(readBackup(own).data.users!.length).toBe(meta.tables.users!.rows);
      process.env.BACKUP_SECRET = "another-backup-secret-0123456789abcd";
      expect(() => readBackup(own)).toThrow(/BACKUP_SECRET differs/);
    } finally {
      delete process.env.BACKUP_SECRET;
    }
  }, 60_000);

  it("covers every table, each after the tables it references", () => {
    const order = tablesInDependencyOrder().map((t) => getTableConfig(t).name);
    expect(new Set(order).size).toBe(order.length);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("cases"));
    expect(order.indexOf("cases")).toBeLessThan(order.indexOf("documents"));
    expect(order.indexOf("documents")).toBeLessThan(order.indexOf("document_files"));
  });

  it("the demo data can be removed from a restored copy (preview first)", async () => {
    const db = await createPgliteDatabase();
    const saved = env.seedDemoData;
    Object.assign(env, { seedDemoData: true });
    try {
      await ensureSeed(db);
    } finally {
      Object.assign(env, { seedDemoData: saved });
    }
    const preview = await removeDemoData(db, { apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.users.length).toBeGreaterThan(0);
    await removeDemoData(db, { apply: true });
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users).where(sql`${s.users.email} like '%@example.com' and ${s.users.role} <> 'admin'`);
    expect(n).toBe(0);
  }, 60_000);
});

describe("backups in System health", () => {
  it("warn until a backup is reported, then show when it was made and that the restore was tested", async () => {
    const { setupDb, getAdmin } = await import("./helpers");
    const { getSystemHealth, recordBackup } = await import("@/lib/services/health");
    const db = await setupDb();
    const admin = await getAdmin(db);
    const card = async () => (await getSystemHealth(db, admin)).checks.find((c) => c.id === "backups")!;
    expect(await card()).toMatchObject({ level: "warning", issues: ["backups_never"] });
    await recordBackup(db, { createdAt: new Date().toISOString(), bytes: 70_000, tables: 40, rows: 848, restoreTested: true });
    expect(await card()).toMatchObject({ level: "ok", issues: [], facts: { rows: 848, restoreTested: true, size: "68 KB" } });
    await recordBackup(db, { createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), bytes: 1, tables: 40, rows: 1, restoreTested: false });
    expect(await card()).toMatchObject({ level: "error", issues: ["backups_late", "backup_untested"] });
  });
});
