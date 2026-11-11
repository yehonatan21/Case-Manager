/**
 * Talking to the iPhone/Android app (mobile/) from the site it shows.
 *
 * Inside the app, Capacitor injects `window.Capacitor` into every page of the site. Its native plugins are
 * called through the bridge's own `nativePromise` / `nativeCallback`, so the site ships no Capacitor code:
 * in a normal browser `window.Capacitor` is absent and everything here is a no-op.
 */

type Bridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
  nativeCallback: (plugin: string, method: string, options: unknown, callback: (data: unknown, err?: unknown) => void) => string;
};

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: Bridge }).Capacitor;
  if (!cap || typeof cap.nativePromise !== "function" || !cap.isNativePlatform?.()) return null;
  return cap;
}

export type NativePlatform = "ios" | "android";

/** "ios" / "android" inside the app; null in a browser. */
export function nativePlatform(): NativePlatform | null {
  const p = bridge()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : null;
}

export const isNativeApp = () => nativePlatform() !== null;

/** Calls a native plugin method. */
export function nativeCall<T = unknown>(plugin: string, method: string, options?: unknown): Promise<T> {
  const b = bridge();
  if (!b) return Promise.reject(new Error("Not in the app"));
  return b.nativePromise(plugin, method, options ?? {}) as Promise<T>;
}

/** Subscribes to a native plugin event; resolves to a function that unsubscribes. */
export function nativeListen<T = unknown>(plugin: string, event: string, cb: (data: T) => void): () => void {
  const b = bridge();
  if (!b) return () => {};
  const id = b.nativeCallback(plugin, "addListener", { eventName: event }, (data) => cb(data as T));
  return () => {
    void b.nativePromise(plugin, "removeListener", { eventName: event, callbackId: id }).catch(() => {});
  };
}

// ---------- Push ----------

/** The app install's push token, kept so the site can tell whether push is on for this phone. */
export const NATIVE_TOKEN_KEY = "cm_native_push_token";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: push still works, the toggle just won't remember */
    }
  },
};
export const nativeStore = store;

export type NativePermission = "granted" | "denied" | "prompt";

export async function nativePushPermission(): Promise<NativePermission> {
  const r = await nativeCall<{ receive?: string }>("PushNotifications", "checkPermissions");
  return r.receive === "granted" ? "granted" : r.receive === "denied" ? "denied" : "prompt";
}

/**
 * Asks for permission and registers with Apple/Google. Resolves with the device token
 * (APNs on iPhone, FCM on Android).
 */
export async function registerNativePush(): Promise<string> {
  let perm = await nativePushPermission();
  if (perm === "prompt") {
    const r = await nativeCall<{ receive?: string }>("PushNotifications", "requestPermissions");
    perm = r.receive === "granted" ? "granted" : "denied";
  }
  if (perm !== "granted") throw Object.assign(new Error("denied"), { denied: true });
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("Push registration timed out")), 20_000);
    const offOk = nativeListen<{ value: string }>("PushNotifications", "registration", (t) => done(null, t.value));
    const offErr = nativeListen<{ error: string }>("PushNotifications", "registrationError", (e) => done(new Error(e?.error || "Push registration failed")));
    function done(err: Error | null, token?: string) {
      clearTimeout(timer);
      offOk();
      offErr();
      if (err) reject(err);
      else resolve(token!);
    }
    nativeCall("PushNotifications", "register").catch((e) => done(e instanceof Error ? e : new Error(String(e))));
  });
}

// ---------- Google sign-in in the system browser ----------

/** The secret for the sign-in under way (see src/lib/services/app-sign-in.ts). */
export const APP_SIGN_IN_KEY = "cm_app_sign_in_verifier";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Opens Google sign-in in the system browser; the browser comes back to the app with a one-time code. */
export async function startAppGoogleSignIn(next?: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  store.set(APP_SIGN_IN_KEY, verifier);
  const q = new URLSearchParams({ app: challenge, ...(next ? { next } : {}) });
  await nativeCall("Browser", "open", { url: `${window.location.origin}/api/auth/google?${q.toString()}`, presentationStyle: "popover" });
}
