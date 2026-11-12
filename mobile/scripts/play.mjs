// Google Play: uploads the Android app and its store listing through the Google Play Developer API.
// Only Node's own crypto and fetch: no third-party action sees the Play credentials.
//
//   node scripts/play.mjs bundle <app-release.aab> [--track internal]   upload a build to a testing track
//   node scripts/play.mjs listing                                     texts and images from store/google-play
//
// PLAY_SERVICE_ACCOUNT: the Play service account's JSON key (raw or base64). PLAY_PACKAGE: the app id (default
// app.casemanager.mobile). Release notes come from store/google-play/<language>/changelogs/default.txt.
// Google requires the very first build of a new app to be uploaded by hand in Play Console (see the README).
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(root, "store/google-play");
const PKG = process.env.PLAY_PACKAGE || "app.casemanager.mobile";
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;
/** Play's limits for the listing texts. */
export const LIMITS = { title: 30, short_description: 80, full_description: 4000, changelog: 500 };

const log = (...a) => console.log("•", ...a);

function serviceAccount() {
  const raw = (process.env.PLAY_SERVICE_ACCOUNT || "").trim();
  if (!raw) throw new Error("PLAY_SERVICE_ACCOUNT is not set");
  const sa = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  if (!sa.client_email || !sa.private_key) throw new Error("PLAY_SERVICE_ACCOUNT is not a service account key");
  return sa;
}

async function accessToken() {
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url")}`;
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

let token;
async function call(method, url, body, contentType = "application/json") {
  token ??= await accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": contentType } : {}) },
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${method} ${url.replace(/^https:\/\/[^/]+/, "")} → ${res.status}: ${text.slice(0, 500)}`), { status: res.status, text });
  return text ? JSON.parse(text) : {};
}

/** Runs `work` inside one edit and commits it; Play applies all of it or none. */
async function inEdit(work) {
  const edit = await call("POST", `${API}/edits`, {});
  try {
    await work(edit.id);
    await call("POST", `${API}/edits/${edit.id}:commit`);
  } catch (e) {
    await call("DELETE", `${API}/edits/${edit.id}`).catch(() => {});
    throw e;
  }
}

/** The listing languages: the folders in store/google-play (Play's codes: iw-IL is Hebrew). */
export function languages() {
  return readdirSync(STORE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(d.name))
    .map((d) => d.name);
}
const text = (lang, file) => {
  const p = join(STORE, lang, file);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
};

async function uploadBundle(aab, track) {
  const notes = languages()
    .map((language) => ({ language, text: text(language, "changelogs/default.txt") }))
    .filter((n) => n.text);
  const attempt = (status) =>
    inEdit(async (id) => {
      const { versionCode } = await call("POST", `${UPLOAD}/edits/${id}/bundles?uploadType=media`, readFileSync(aab), "application/octet-stream");
      log(`uploaded version ${versionCode}`);
      await call("PUT", `${API}/edits/${id}/tracks/${track}`, { track, releases: [{ versionCodes: [String(versionCode)], status, releaseNotes: notes }] });
      log(`release on the ${track} track (${status})`);
    });
  try {
    await attempt("completed");
  } catch (e) {
    // Until the app has been published once, Play only accepts draft releases (finish them in Play Console).
    if (!/draft app/i.test(e.text || "")) throw e;
    log("the app isn't published yet: saving the release as a draft");
    await attempt("draft");
  }
}

async function uploadListing() {
  await inEdit(async (id) => {
    for (const language of languages()) {
      const listing = { language, title: text(language, "title.txt"), shortDescription: text(language, "short_description.txt"), fullDescription: text(language, "full_description.txt") };
      if (!listing.title) continue;
      await call("PUT", `${API}/edits/${id}/listings/${language}`, listing);
      log(`${language}: texts`);
      const images = join(STORE, language, "images");
      for (const [type, files] of [
        ["icon", ["icon.png"]],
        ["featureGraphic", ["featureGraphic.png"]],
        ["phoneScreenshots", existsSync(join(images, "phoneScreenshots")) ? readdirSync(join(images, "phoneScreenshots")).sort().map((f) => `phoneScreenshots/${f}`) : []],
      ]) {
        const present = files.filter((f) => existsSync(join(images, f)));
        if (!present.length) continue;
        await call("DELETE", `${API}/edits/${id}/listings/${language}/${type}`);
        for (const f of present) await call("POST", `${UPLOAD}/edits/${id}/listings/${language}/${type}?uploadType=media`, readFileSync(join(images, f)), "image/png");
        log(`${language}: ${type} (${present.length})`);
      }
    }
  });
}

/** The texts fit Play's limits (also run by `npm run check`). */
export function checkListing() {
  const problems = [];
  for (const lang of languages()) {
    for (const [file, max] of [
      ["title.txt", LIMITS.title],
      ["short_description.txt", LIMITS.short_description],
      ["full_description.txt", LIMITS.full_description],
      ["changelogs/default.txt", LIMITS.changelog],
    ]) {
      const t = text(lang, file);
      if (!t) problems.push(`${lang}/${file} is missing`);
      else if ([...t].length > max) problems.push(`${lang}/${file}: ${[...t].length} characters (Play allows ${max})`);
    }
  }
  return problems;
}

/** The command line: `bundle <aab> [--track internal]` or `listing`. */
export async function runCli(args) {
  const [cmd, arg] = args;
  const track = args.includes("--track") ? args[args.indexOf("--track") + 1] : "internal";
  const problems = checkListing();
  if (problems.length) throw new Error(problems.join("\n"));
  if (cmd === "bundle" && arg) return uploadBundle(arg, track);
  if (cmd === "listing") return uploadListing();
  throw new Error("usage: play.mjs bundle <app-release.aab> [--track internal|alpha|beta|production] | listing");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(
    () => log("done"),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
