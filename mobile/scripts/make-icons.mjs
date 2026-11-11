// Draws the app icons and launch screens for iOS and Android from assets/glyph.svg (the same mark as the
// site's icons in public/icons). Run from mobile/: `node scripts/make-icons.mjs` (uses sharp from the site).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sharp = createRequire(join(root, "..", "package.json"))("sharp");
const BRAND = "#4338CA";
const glyph = readFileSync(join(root, "assets/glyph.svg"), "utf8");
const inner = glyph.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The mark on a canvas: `scale` of the canvas holds the 512-unit artwork, centred, over `bg` (or transparent). */
const svg = (size, { bg, scale = 1, color = "#fff" }) => {
  const s = (size * scale) / 512;
  const off = (size - 512 * s) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      (bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : "") +
      `<g transform="translate(${off} ${off}) scale(${s})">${inner.replaceAll("#fff", color)}</g></svg>`,
  );
};
const png = async (file, buf, w, h) => {
  mkdirSync(dirname(file), { recursive: true });
  let img = sharp(buf);
  if (h && h !== w) img = img.resize(w, h, { fit: "contain", background: "#ffffff" });
  writeFileSync(file, await img.png({ compressionLevel: 9 }).toBuffer());
};

// iOS: one 1024 px icon, no transparency (iOS rounds the corners itself).
await png(join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"), svg(1024, { bg: BRAND }));

// Android launcher icons: legacy square/round, plus the adaptive foreground (glyph inside the 66% safe zone).
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const res = join(root, `android/app/src/main/res/mipmap-${d}`);
  const legacy = Math.round(48 * k);
  await png(join(res, "ic_launcher.png"), svg(legacy, { bg: BRAND }));
  const round = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><defs><clipPath id="c"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></clipPath></defs><g clip-path="url(#c)"><image href="data:image/svg+xml;base64,${svg(legacy, { bg: BRAND }).toString("base64")}" width="${legacy}" height="${legacy}"/></g></svg>`,
  );
  await png(join(res, "ic_launcher_round.png"), round);
  await png(join(res, "ic_launcher_foreground.png"), svg(Math.round(108 * k), { scale: 0.9 }));
}

// Launch screens: the mark on white, centred.
await png(join(root, "android/app/src/main/res/drawable/splash.png"), svg(480, { bg: "#ffffff", scale: 0.5, color: BRAND }));
for (const o of ["land", "port"])
  for (const [d, k] of Object.entries(densities)) {
    const [w, h] = o === "port" ? [320 * k, 480 * k] : [480 * k, 320 * k];
    await png(join(root, `android/app/src/main/res/drawable-${o}-${d}/splash.png`), svg(Math.min(w, h), { bg: "#ffffff", scale: 0.5, color: BRAND }), w, h);
  }
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"])
  await png(join(root, `ios/App/App/Assets.xcassets/Splash.imageset/${name}`), svg(2732, { bg: "#ffffff", scale: 0.22, color: BRAND }));

console.log("Icons and launch screens written.");
