import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { expectCode, getAdmin, makeUser, setupDb } from "./helpers";

// A stand-in SMTP library: records what would be sent, and can refuse.
const smtp = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  options: [] as unknown[],
  refuse: false,
}));
vi.mock("nodemailer", () => ({
  default: {},
  createTransport: (options: unknown) => {
    smtp.options.push(options);
    return {
      sendMail: async (m: Record<string, unknown>) => {
        if (smtp.refuse) throw new Error("535 Authentication failed");
        smtp.sent.push(m);
      },
    };
  },
}));

import { connectEmail, disconnectEmail, getEmailStatus, sendTestEmail } from "@/lib/services/email";
import { sendEmail, emailDelivers } from "@/lib/email";
import { requestLoginCode } from "@/lib/services/auth";
import { getSystemHealth } from "@/lib/services/health";

let db: Database;
let admin: s.User;
beforeAll(async () => {
  db = await setupDb();
  admin = await getAdmin(db);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  smtp.sent.length = 0;
  smtp.refuse = false;
  await disconnectEmail(db, admin);
});

const smtpInput = {
  provider: "smtp" as const,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "office@example.com",
  password: "app-password-1",
  fromAddress: "office@example.com",
  fromName: "המשרד",
};

describe("email service in Settings → Integrations", () => {
  it("connecting SMTP sends a test email to the admin first, then stores the details encrypted", async () => {
    expect(await getEmailStatus(db)).toMatchObject({
      connected: false,
      fallback: "console",
    });
    await connectEmail(db, admin, smtpInput);
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0]).toMatchObject({
      to: admin.email,
      from: { name: "המשרד", address: "office@example.com" },
    });
    expect(smtp.options.at(-1)).toMatchObject({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: { user: "office@example.com", pass: "app-password-1" },
    });
    const status = await getEmailStatus(db);
    expect(status).toMatchObject({
      connected: true,
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      fromAddress: "office@example.com",
    });
    expect(JSON.stringify(status)).not.toContain("app-password-1");
    const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "integrations.email"));
    expect(JSON.stringify(row!.value)).not.toContain("app-password-1");

    // Sign-in codes and other emails now go through it, and the code isn't shown on screen.
    expect(await emailDelivers(db)).toBe(true);
    const client = await makeUser(db, "customer");
    const r = await requestLoginCode(db, {
      email: client.email,
      ip: null,
      locale: "he",
      purpose: "login",
    });
    expect(r.devCode).toBeUndefined();
    expect(smtp.sent.at(-1)).toMatchObject({ to: client.email });
    // Without the database, the old way (SMTP_URL or the console) is used.
    const before = smtp.sent.length;
    await sendEmail({
      to: "x@example.com",
      subject: "s",
      text: "t",
      html: "h",
    });
    expect(smtp.sent.length).toBe(before);

    // Re-saving without the password keeps it.
    await connectEmail(db, admin, {
      ...smtpInput,
      password: "",
      fromName: "Office",
    });
    expect(smtp.options.at(-1)).toMatchObject({
      auth: { pass: "app-password-1" },
    });
    expect((await getEmailStatus(db)).fromName).toBe("Office");
    // System health counts it as a working email service.
    const card = (await getSystemHealth(db, admin)).checks.find((c) => c.id === "email")!;
    expect(card.facts).toMatchObject({
      provider: "smtp",
      sender: "office@example.com",
    });
    expect(card.issues).not.toContain("email_console");
  });

  it("a refused test email saves nothing; only admins connect; bad details are rejected", async () => {
    smtp.refuse = true;
    await expectCode(connectEmail(db, admin, smtpInput), "email_refused");
    expect((await getEmailStatus(db)).connected).toBe(false);
    smtp.refuse = false;
    await expectCode(connectEmail(db, await makeUser(db, "case_manager"), smtpInput), "forbidden");
    await expectCode(connectEmail(db, admin, { ...smtpInput, host: "not a host" }), "validation");
    await expectCode(connectEmail(db, admin, { ...smtpInput, fromAddress: "nope" }), "validation");
    await expectCode(
      connectEmail(db, admin, {
        provider: "resend",
        apiKey: "bad",
        fromAddress: "a@b.co",
      }),
      "validation",
    );
    await expectCode(sendTestEmail(db, admin), "validation");
  });

  it("Resend: sent through its API with the key; a test email can be sent again", async () => {
    const calls: {
      url: string;
      auth: string | null;
      body: Record<string, unknown>;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          auth: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ id: "email_1" });
      }),
    );
    await connectEmail(db, admin, {
      provider: "resend",
      apiKey: "re_test_key_123456",
      fromAddress: "updates@example.com",
      fromName: "Case Manager",
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.resend.com/emails",
      auth: "Bearer re_test_key_123456",
      body: { from: "Case Manager <updates@example.com>", to: [admin.email] },
    });
    expect(await getEmailStatus(db)).toMatchObject({
      provider: "resend",
      keyHint: "••••3456",
    });
    await sendTestEmail(db, admin);
    expect(calls).toHaveLength(2);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 })),
    );
    await expectCode(sendTestEmail(db, admin), "email_refused");
  });
});
