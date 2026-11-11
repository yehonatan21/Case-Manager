"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NATIVE_TOKEN_KEY, nativePlatform, nativePushPermission, nativeStore, registerNativePush } from "@/lib/native";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/**
 * "Notifications on this device": subscribes this browser to Web Push (per device, not per account).
 * Inside the iPhone/Android app it registers the phone for native push instead (browser push doesn't reach an
 * app's web view).
 */
export function PushToggle({ className }: { className?: string }) {
  const { d } = useI18n();
  const t = d.push;
  const toast = useToast();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
  const [app, setApp] = useState<"ios" | "android" | null>(null);

  useEffect(() => {
    (async () => {
      const platform = nativePlatform();
      if (platform) {
        setApp(platform);
        if ((await nativePushPermission()) === "denied") return setState("denied");
        const token = nativeStore.get(NATIVE_TOKEN_KEY);
        const { on } = token ? await api<{ on: boolean }>(`/api/push/native?token=${encodeURIComponent(token)}`) : { on: false };
        return setState(on ? "on" : "off");
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone/iPad only allow push for apps added to the home screen.
        setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enableApp(platform: "ios" | "android") {
    setBusy("on");
    try {
      const token = await registerNativePush();
      await api("/api/push/native", { body: { platform, token } });
      nativeStore.set(NATIVE_TOKEN_KEY, token);
      setState("on");
      toast("success", t.enabled);
    } catch (e) {
      if ((e as { denied?: boolean }).denied) setState("denied");
      else toast("error", e instanceof Error && !("code" in e) ? t.appFailed : errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  async function disableApp() {
    setBusy("off");
    try {
      const token = nativeStore.get(NATIVE_TOKEN_KEY);
      if (token) await api("/api/push/native", { method: "DELETE", body: { token } });
      nativeStore.set(NATIVE_TOKEN_KEY, null);
      setState("off");
      toast("success", t.disabled);
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  async function enable() {
    if (app) return enableApp(app);
    setBusy("on");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>("/api/push/key");
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await api("/api/push/subscription", { body: sub.toJSON() });
      setState("on");
      toast("success", t.enabled);
    } catch (e) {
      toast("error", e instanceof Error && !("code" in e) ? t.failed : errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (app) return disableApp();
    setBusy("off");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api("/api/push/subscription", { method: "DELETE", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setState("off");
      toast("success", t.disabled);
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      await api("/api/push/test", { body: {} });
      toast("success", t.testSent);
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  }

  const note = { "ios-install": t.iosInstall, unsupported: t.unsupported, denied: app ? t.appDenied : t.denied, loading: "", off: t.offHint, on: app ? t.appOnHint : t.onHint }[state];

  return (
    <div className={className} data-push-state={state} data-push-kind={app ? "app" : "web"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
            {state === "on" ? <Bell className="size-4.5" aria-hidden /> : <BellOff className="size-4.5" aria-hidden />}
          </span>
          <div>
            <p className="font-medium text-slate-900">{t.title}</p>
            {note && <p className="text-sm text-slate-600">{note}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {state === "off" && (
            <Button size="sm" onClick={enable} loading={busy === "on"}>
              <Bell className="size-4" aria-hidden /> {t.enable}
            </Button>
          )}
          {state === "on" && (
            <>
              <Button size="sm" variant="outline" onClick={test} loading={busy === "test"}>
                <Send className="size-4" aria-hidden /> {t.test}
              </Button>
              <Button size="sm" variant="ghost" onClick={disable} loading={busy === "off"}>
                {t.disable}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
