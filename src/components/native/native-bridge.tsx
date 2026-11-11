"use client";

import { useEffect } from "react";
import { api } from "@/lib/client-api";
import { APP_SIGN_IN_KEY, NATIVE_TOKEN_KEY, isNativeApp, nativeCall, nativeListen, nativePlatform, nativePushPermission, nativeStore, registerNativePush } from "@/lib/native";

const LAUNCH_HANDLED = "cm_app_launch_handled";

/** Only same-site paths are followed from a notification or a deep link. */
function sitePath(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}

/** Back from Google sign-in in the system browser: <scheme>://auth?code=… or ?error=… */
async function finishSignIn(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol.startsWith("http") || u.host !== "auth") return;
  void nativeCall("Browser", "close").catch(() => {});
  const code = u.searchParams.get("code");
  const verifier = nativeStore.get(APP_SIGN_IN_KEY);
  nativeStore.set(APP_SIGN_IN_KEY, null);
  if (!code || !verifier) {
    const error = (u.searchParams.get("error") ?? "google_failed").replace(/[^a-z_]/g, "") || "google_failed";
    window.location.assign(`/login?error=${error}`);
    return;
  }
  try {
    const { next } = await api<{ next: string }>("/api/auth/app-sign-in", { body: { code, verifier } });
    window.location.assign(sitePath(next) ?? "/");
  } catch {
    window.location.assign("/login?error=google_failed");
  }
}

/**
 * Mounted on every page; does nothing outside the iPhone/Android app. Inside it:
 *  - finishes Google sign-in when the system browser hands the app its one-time code;
 *  - opens the page a tapped notification points to;
 *  - keeps this phone's push token current (Apple and Google can rotate it).
 */
export function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.dataset.nativeApp = nativePlatform() ?? "";
    const offs = [
      nativeListen<{ url: string }>("App", "appUrlOpen", (e) => void finishSignIn(e.url)),
      nativeListen<{ notification?: { data?: { url?: string } } }>("PushNotifications", "pushNotificationActionPerformed", (e) => {
        const path = sitePath(e.notification?.data?.url);
        if (path) window.location.assign(path);
      }),
    ];
    // Cold start from the sign-in link. The app reports the same launch URL for as long as it runs, so each
    // one is handled once (the code is single-use; handling it again would fail and loop).
    void nativeCall<{ url?: string } | undefined>("App", "getLaunchUrl")
      .then((r) => {
        if (!r?.url) return;
        try {
          if (sessionStorage.getItem(LAUNCH_HANDLED) === r.url) return;
          sessionStorage.setItem(LAUNCH_HANDLED, r.url);
        } catch {
          return;
        }
        return finishSignIn(r.url);
      })
      .catch(() => {});
    // Push was turned on here before: re-register, and tell the server if the token changed.
    const saved = nativeStore.get(NATIVE_TOKEN_KEY);
    const platform = nativePlatform();
    if (saved && platform) {
      void (async () => {
        if ((await nativePushPermission()) !== "granted") return;
        const token = await registerNativePush();
        if (token === saved) return;
        await api("/api/push/native", { body: { platform, token } });
        await api("/api/push/native", { method: "DELETE", body: { token: saved } }).catch(() => {});
        nativeStore.set(NATIVE_TOKEN_KEY, token);
      })().catch(() => {});
    }
    return () => offs.forEach((off) => off());
  }, []);
  return null;
}
