import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * mobile/scripts/play.mjs against a stand-in for the Google Play Developer API: the requests it makes, in order,
 * the fallback to a draft release while the app isn't published, and the listing texts' limits.
 */
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { client_email: "play@case-app.iam.gserviceaccount.com", private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token" };

type Req = { method: string; path: string; body: unknown };
let requests: Req[] = [];
let draftOnly = false;

function fakeGoogle() {
  return vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: unknown }) => {
    const u = new URL(url);
    const body = typeof init.body === "string" ? (init.body.startsWith("{") ? JSON.parse(init.body) : init.body) : init.body ? "<binary>" : undefined;
    requests.push({ method: init.method, path: u.pathname.replace("/androidpublisher/v3/applications/app.casemanager.mobile", ""), body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    if (u.host === "oauth2.googleapis.com") {
      const assertion = new URLSearchParams(String(init.body)).get("assertion")!;
      const [h, p, sig] = assertion.split(".");
      const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), rsa.publicKey, Buffer.from(sig!, "base64url"));
      expect(JSON.parse(Buffer.from(p!, "base64url").toString()).scope).toBe("https://www.googleapis.com/auth/androidpublisher");
      return json(ok ? 200 : 401, { access_token: "play-token" });
    }
    expect(init.headers.Authorization).toBe("Bearer play-token");
    if (u.pathname.endsWith("/edits") && init.method === "POST") return json(200, { id: `edit${requests.length}` });
    if (u.pathname.includes("/bundles")) return json(200, { versionCode: 42 });
    if (u.pathname.endsWith(":commit")) {
      const track = [...requests].reverse().find((r) => r.path.includes("/tracks/"));
      const status = (track?.body as { releases: { status: string }[] } | undefined)?.releases[0]!.status;
      if (draftOnly && status && status !== "draft") return json(400, { error: { message: "Only releases with status draft may be created on draft app." } });
      return json(200, {});
    }
    return json(200, {});
  });
}

let play: { checkListing: () => string[]; languages: () => string[] };
const script = join(__dirname, "..", "mobile", "scripts", "play.mjs");

beforeAll(async () => {
  play = await import(script);
});
afterEach(() => {
  requests = [];
  draftOnly = false;
  vi.unstubAllGlobals();
});

/** Runs the CLI in-process with fetch replaced. */
async function run(args: string[]) {
  vi.stubGlobal("fetch", fakeGoogle());
  process.env.PLAY_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(SA)).toString("base64");
  const { runCli } = (await import(script)) as { runCli: (a: string[]) => Promise<void> };
  await runCli(args);
}

describe("Google Play upload", () => {
  it("the listing texts are within Play's limits in Hebrew and English", () => {
    expect(play.languages().sort()).toEqual(["en-US", "iw-IL"]);
    expect(play.checkListing()).toEqual([]);
  });

  it("uploads the bundle to a track with the release notes, in one edit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aab-"));
    writeFileSync(join(dir, "app.aab"), "bundle");
    await run(["bundle", join(dir, "app.aab"), "--track", "internal"]);
    const api = requests.filter((r) => !r.path.startsWith("/token"));
    expect(api.map((r) => `${r.method} ${r.path.replace(/edit\d+/, "E")}`)).toEqual([
      "POST /edits",
      "POST /upload/edits/E/bundles",
      "PUT /edits/E/tracks/internal",
      "POST /edits/E:commit",
    ]);
    const track = api[2]!.body as { releases: { versionCodes: string[]; status: string; releaseNotes: { language: string; text: string }[] }[] };
    expect(track.releases[0]).toMatchObject({ versionCodes: ["42"], status: "completed" });
    expect(track.releases[0]!.releaseNotes.map((n) => n.language).sort()).toEqual(["en-US", "iw-IL"]);
  });

  it("before the app is published, saves the release as a draft", async () => {
    draftOnly = true;
    const dir = mkdtempSync(join(tmpdir(), "aab-"));
    writeFileSync(join(dir, "app.aab"), "bundle");
    await run(["bundle", join(dir, "app.aab")]);
    const tracks = requests.filter((r) => r.path.includes("/tracks/")).map((r) => (r.body as { releases: { status: string }[] }).releases[0]!.status);
    expect(tracks).toEqual(["completed", "draft"]);
    expect(requests.some((r) => r.method === "DELETE" && /\/edits\/edit\d+$/.test(r.path))).toBe(true); // the failed edit is discarded
  });

  it("updates the listing texts and replaces the images per language", async () => {
    await run(["listing"]);
    const listings = requests.filter((r) => r.method === "PUT" && r.path.includes("/listings/"));
    expect(listings.map((r) => (r.body as { language: string }).language).sort()).toEqual(["en-US", "iw-IL"]);
    const he = listings.find((r) => (r.body as { language: string }).language === "iw-IL")!.body as { title: string; shortDescription: string };
    expect(he.title).toContain("ניהול תיקים");
    for (const lang of ["iw-IL", "en-US"]) {
      for (const type of ["icon", "featureGraphic", "phoneScreenshots"]) {
        expect(requests.some((r) => r.method === "DELETE" && r.path.endsWith(`/listings/${lang}/${type}`)), `${lang} ${type} cleared`).toBe(true);
      }
      expect(requests.filter((r) => r.method === "POST" && r.path.endsWith(`/listings/${lang}/phoneScreenshots`)).length).toBeGreaterThanOrEqual(2);
    }
    expect(requests.at(-1)!.path).toMatch(/:commit$/);
  });

  it("refuses to run without the service account", () => {
    const r = spawnSync(process.execPath, [script, "listing"], { env: { ...process.env, PLAY_SERVICE_ACCOUNT: "" }, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("PLAY_SERVICE_ACCOUNT is not set");
  });
});
