"use client";

import { useEffect } from "react";

/** Sends a browser error to the app (Settings → System health shows them to admins). At most 5 per page. */
const sent = new Set<string>();

export function reportBrowserError(err: unknown) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err ?? "Unknown error"));
    const message = `${e.name}: ${e.message}`.slice(0, 2000);
    if (sent.size >= 5 || sent.has(message)) return;
    // Errors from browser extensions and cross-origin scripts aren't the app's.
    if (/^(Script error\.?|ResizeObserver loop)/.test(e.message) || /extension:\/\//.test(e.stack ?? "")) return;
    sent.add(message);
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, stack: e.stack?.slice(0, 8000) ?? null, path: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => reportBrowserError(ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportBrowserError(ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
