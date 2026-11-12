// Checks that the iPhone and Android projects carry what the app needs, and agree with each other and with
// the server: one app id everywhere (it's also the sign-in return URL scheme), camera/photo permission texts,
// push (iPhone: entitlement + token forwarding; Android: permission), the sign-in return link.
// Run from mobile/: `npm run check` (also run in CI before each build).
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const need = (ok, what) => ok || problems.push(what);

const appId = (read("capacitor.config.ts").match(/appId:\s*"([^"]+)"/) || [])[1];
need(appId, "capacitor.config.ts: appId");
const serverScheme = (read("../src/lib/env.ts").match(/APP_URL_SCHEME",\s*"([^"]+)"/) || [])[1];
need(serverScheme === appId, `server's default APP_URL_SCHEME (${serverScheme}) = appId (${appId})`);
const apnsTopic = (read("../src/lib/env.ts").match(/APNS_TOPIC",\s*"([^"]+)"/) || [])[1];
need(apnsTopic === appId, `server's default APNS_TOPIC (${apnsTopic}) = appId (${appId})`);

// iPhone
const plist = read("ios/App/App/Info.plist");
const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
need([...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].every((m) => m[1] === appId), "iOS bundle id = appId");
need((pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g) || []).length === 2, "iOS entitlements in Debug and Release");
need(/aps-environment/.test(read("ios/App/App/App.entitlements")), "iOS push entitlement (aps-environment)");
need(new RegExp(`<key>CFBundleURLSchemes</key>\\s*<array>\\s*<string>${appId.replace(/\./g, "\\.")}</string>`).test(plist), "iOS URL scheme = appId (sign-in return)");
for (const k of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) need(new RegExp(`<key>${k}</key>\\s*<string>[^<]{20,}</string>`).test(plist), `iOS ${k}`);
need(/remote-notification/.test(plist), "iOS background mode remote-notification");
const delegate = read("ios/App/App/AppDelegate.swift");
need(/capacitorDidRegisterForRemoteNotifications/.test(delegate) && /capacitorDidFailToRegisterForRemoteNotifications/.test(delegate), "iOS AppDelegate forwards the push token");
need(/openURLContexts/.test(read("ios/App/App/SceneDelegate.swift")), "iOS SceneDelegate forwards opened URLs");

// Android
const manifest = read("android/app/src/main/AndroidManifest.xml");
need(new RegExp(`applicationId "${appId.replace(/\./g, "\\.")}"`).test(read("android/app/build.gradle")), "Android applicationId = appId");
need(new RegExp(`android:scheme="${appId.replace(/\./g, "\\.")}" android:host="auth"`).test(manifest), "Android sign-in return link (scheme = appId, host auth)");
for (const p of ["INTERNET", "CAMERA", "POST_NOTIFICATIONS"]) need(manifest.includes(`android.permission.${p}"`), `Android permission ${p}`);
need(fs.existsSync(path.join(root, "android/app/src/main/res/drawable/ic_stat_notify.xml")), "Android notification icon");

// The offline screen the app shows when the site can't be reached.
need(fs.existsSync(path.join(root, "www/offline.html")), "www/offline.html");

// Google Play listing texts within Play's limits.
const { pathToFileURL } = require("node:url");
module.exports.done = import(pathToFileURL(path.join(__dirname, "play.mjs")).href).then(({ checkListing }) => {
  for (const p of checkListing()) problems.push(`Play listing: ${p}`);
  finish();
});

function finish() {
if (problems.length) {
  console.error("Missing or inconsistent:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log(`Native settings OK (app id ${appId}); Play listing texts within limits.`);
}
