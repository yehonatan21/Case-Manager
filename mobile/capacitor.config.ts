import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The iPhone and Android app is a native shell around the live site: every screen, the Hebrew/RTL layout and
 * every feature come from the server, so a website release reaches the app without a store update.
 *
 * CAP_SERVER_URL picks the site the app opens (production by default; a preview URL for testing).
 * The bundle id / application id is baked into ios/ and android/ — see mobile/README.md to change it.
 */
const serverUrl = (process.env.CAP_SERVER_URL || "https://case-manager-eta.vercel.app").replace(/\/+$/, "");
const host = new URL(serverUrl).host;

const config: CapacitorConfig = {
  appId: "app.casemanager.mobile",
  appName: "Case Manager",
  // Shown only when the site can't be reached (offline.html), never as the app itself.
  webDir: "www",
  // Lets the site tell it runs inside the app (server side: user agent; client side: window.Capacitor).
  appendUserAgent: "CaseManagerApp/1",
  backgroundColor: "#ffffff",
  server: {
    url: serverUrl,
    // Other sites open in the system browser (Google sign-in must: it refuses embedded web views).
    // The payment page (Grow) stays in the app, so the client lands back on their case afterwards.
    allowNavigation: [host, "*.meshulam.co.il"],
    errorPath: "offline.html",
    cleartext: serverUrl.startsWith("http://"),
  },
  ios: {
    // The site doesn't draw under the notch or the home indicator: keep it inside the safe area.
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 800, launchAutoHide: true, backgroundColor: "#ffffff", showSpinner: false },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    // Android 15+ draws apps edge to edge; the site doesn't, so the web view sits between the system bars.
    SystemBars: { insetsHandling: "native", style: "LIGHT" },
  },
};

export default config;
