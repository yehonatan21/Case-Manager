# Case Manager for iPhone and Android

A native app (Capacitor 8) that opens the live site. The site renders its pages on the server with the
signed-in person's session, so the app doesn't package the pages; it shows the site, and a site release
reaches the app straight away without a new store version. The app adds what a web page can't do inside an app:

| | How |
|---|---|
| **Push notifications** | The phone registers with Apple (APNs) or Google (Firebase Cloud Messaging); the site sends to it from the same outbox as browser push. Same **Notifications on this device** switch. |
| **Google sign-in** | Google blocks sign-in inside apps' web views. It opens in the system browser, which hands the app a one-time code that only the app can redeem (it holds the matching secret). |
| **Camera** | Upload buttons offer the camera and the photo library (permission texts in Hebrew and English). |
| **Payments** | The Grow payment page opens inside the app, so the client returns to their case. Real-world services, so Apple's in-app purchase doesn't apply. |
| **Offline** | A screen with "Try again" when the site can't be reached, instead of an error page. |

Everything else (every screen, Hebrew/RTL, sign-in by email code) is the site itself.

## What's here

```
mobile/
  capacitor.config.ts   app id, name, which site it opens (CAP_SERVER_URL), plugins
  www/offline.html      the offline screen (the only page inside the app)
  ios/                  the Xcode project (Swift Package Manager; no CocoaPods)
  android/              the Android Studio project
  assets/glyph.svg      the icon mark; scripts/make-icons.mjs draws every icon and launch screen from it
  scripts/check-config.cjs   checks the native settings agree (run in CI)
```

The site's side: [`src/lib/native.ts`](../src/lib/native.ts) (talks to the app),
[`native-bridge.tsx`](../src/components/native/native-bridge.tsx) (sign-in return, tapped notifications),
[`native-push.ts`](../src/lib/services/native-push.ts) (sending), [`app-sign-in.ts`](../src/lib/services/app-sign-in.ts).

## Build and run

You need Node 22, and **Xcode 16+ on a Mac** for iPhone, **Android Studio** (JDK 21) for Android.

```bash
cd mobile
npm install
npx cap sync
npx cap open ios       # or: npx cap open android
```

Then press Run in Xcode / Android Studio (a simulator, or a phone connected by cable).

To point the app at the dev site instead of production:

```bash
CAP_SERVER_URL=https://case-manager-git-dev-yehonatan21.vercel.app npx cap sync
```

**Without a Mac:** every pull request that touches `mobile/` builds both apps in GitHub Actions
(**Mobile app** workflow). The Android build is attached to the run as `case-manager-android-debug`:
download it, unzip it, and open `app-debug.apk` on an Android phone (allow installing from this source).

## Push notifications: the keys (one time)

Set these on the server (Vercel → Settings → Environment Variables, Production), then redeploy. Without them
the app still works; phones on that platform just don't get notifications.

**iPhone (APNs):**
1. [developer.apple.com](https://developer.apple.com/account/resources/authkeys/list) → Keys → **+** → tick
   *Apple Push Notifications service (APNs)* → download the `.p8` file (once only).
2. `APNS_KEY` = the file's contents, `APNS_KEY_ID` = the key's ID, `APNS_TEAM_ID` = your Team ID (top right of
   the developer site). `APNS_TOPIC` = the bundle id if you changed it.
3. Builds run from Xcode use Apple's sandbox: set `APNS_ENVIRONMENT=sandbox` on the dev site to test those.
   TestFlight and App Store builds use production (the default).

**Android (Firebase Cloud Messaging):**
1. [console.firebase.google.com](https://console.firebase.google.com) → add a project → add an **Android app**
   with the package name `app.casemanager.mobile` → download **`google-services.json`** into
   `mobile/android/app/` (the Android build needs it for push).
2. Project settings → Service accounts → **Generate new private key** → `FCM_SERVICE_ACCOUNT` = the file's
   contents (or the contents base64-encoded).

## Google sign-in

Nothing new to configure: the app uses the site's existing Google sign-in (`GOOGLE_CLIENT_ID`/`SECRET`) through
the system browser. When it finishes, the browser opens `app.casemanager.mobile://auth?code=…`; on iPhone Safari
may ask "Open in Case Manager?" first.

## Changing the app id

The app id `app.casemanager.mobile` is also the sign-in return scheme and the APNs topic. To use your own
(e.g. `il.co.yourfirm.cases`), change it in `capacitor.config.ts`, `ios/App/App.xcodeproj/project.pbxproj`
(`PRODUCT_BUNDLE_IDENTIFIER`), `ios/App/App/Info.plist` (`CFBundleURLSchemes`), `android/app/build.gradle`
(`namespace`, `applicationId`), `android/app/src/main/AndroidManifest.xml` (`android:scheme`) and
`android/app/src/main/res/values/strings.xml`, and set `APP_URL_SCHEME` and `APNS_TOPIC` on the server.
`npm run check` lists anything that doesn't match.

## Publishing

**App Store** (Apple Developer Program, $99/year):
1. In Xcode: App target → Signing & Capabilities → your team. Push Notifications is already there.
2. Product → Archive → Distribute → App Store Connect. Then TestFlight, then submit for review.
3. Review notes that help: the app has native push, native sign-in and camera uploads (not just a website),
   and a demo account (an email that can receive the sign-in code) for the reviewer.
4. App Store Connect asks for a privacy policy URL: `https://<your site>/privacy`.

**Google Play**: see [Google Play](#google-play) below. CI builds, signs and uploads the Android app.

Version numbers: `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode; on Android `versionName` is
`version` in `mobile/package.json` and `versionCode` is the CI run number. A new store version is needed only for native changes (icons, permissions,
plugins), not for site changes.

## Google Play

The **Google Play release** workflow (`.github/workflows/play-release.yml`) builds a signed Android App Bundle,
keeps it as a download on the run, and, with a Play service account, uploads it to a testing track with the
release notes and (on request) the whole store listing from [`store/google-play/`](store/google-play/).
It runs when changes to `mobile/` reach `main` (to **internal testing**) and by hand: Actions →
**Google Play release** → Run workflow (choose the track; tick *Also update the store listing*).

### One-time setup

**1. Play Console account.** [play.google.com/console](https://play.google.com/console), $25 once. Google
verifies your identity (a few days). New personal accounts must run a **closed test with at least 12 testers for
14 days** before they can publish to everyone. An organization account (with a D-U-N-S number) skips that.

**2. The upload key.** Make it once on your computer and keep the file and passwords somewhere safe (a password
manager). Google re-signs the app for users (Play App Signing), so a lost upload key can be reset, but it takes
time.

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

```bash
base64 -w0 upload.jks > upload.jks.b64
```

(On a Mac: `base64 -i upload.jks -o upload.jks.b64`.)

**3. Repository secrets.** GitHub → the repository → Settings → Secrets and variables → Actions →
New repository secret. Paste each value there and nowhere else:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the contents of `upload.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` (the alias you chose) |
| `ANDROID_KEY_PASSWORD` | the key password, if you set a different one |
| `GOOGLE_SERVICES_JSON` | Firebase's `google-services.json` (for push; see above) |
| `PLAY_SERVICE_ACCOUNT` | the Play service account's JSON key (step 6) |

**4. Create the app in Play Console.** Create app → name *Case Manager*, default language **Hebrew – iw-IL**,
App, Free. Then fill in **App content**, using the answers in
[`store/google-play/README.md`](store/google-play/README.md): privacy policy, app access (a demo account for
the reviewer), ads (none), content rating, target audience, data safety, government app (no), financial features
(none of the listed ones: payments go through a licensed provider).

**5. The first upload is by hand** (Google requires it before the API can upload). Run the workflow once
(Actions → Google Play release → Run workflow), download **case-manager-android-N** from the run, and in Play
Console → Testing → Internal testing → Create new release, upload `app-release.aab`.

**6. Automatic uploads from then on.**
1. [Google Cloud console](https://console.cloud.google.com) → the same project as Firebase (or a new one) →
   APIs & Services → enable **Google Play Android Developer API**.
2. IAM & Admin → Service accounts → Create → no roles needed → Keys → Add key → JSON. That file is
   `PLAY_SERVICE_ACCOUNT`.
3. Play Console → Users and permissions → Invite new users → the service account's email → for this app:
   *Release apps to testing tracks*, *Manage testing tracks*, and *Edit store listing*. Add *Release to
   production* if you want the workflow to publish to production too.

Now every change to `mobile/` on `main` reaches internal testers, and you promote a release to closed testing or
production in Play Console (or run the workflow with that track). Until the app has been published once, Play
only accepts **draft** releases; the workflow then saves the release as a draft for you to roll out in Play
Console.

### The store listing

[`store/google-play/`](store/google-play/) holds the listing in Hebrew (`iw-IL`) and English (`en-US`): title,
short and full description, release notes (`changelogs/default.txt`), the icon, the feature graphic and phone
screenshots. `npm run check` keeps the texts within Play's limits. Run the workflow with *Also update the store
listing* to send it all to Play, or copy it into Play Console by hand.

To retake the screenshots and the feature graphic from the site (demo mode, with its demo data):

```bash
BASE=http://localhost:3000 node mobile/scripts/store-images.cjs
```

## Icons and launch screens

```bash
node scripts/make-icons.mjs
```

Draws the iPhone icon (1024 px), the Android launcher icons (adaptive and legacy, every density) and the launch
screens from `assets/glyph.svg`, in the site's indigo.
