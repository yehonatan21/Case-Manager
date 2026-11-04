"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Keeps server-rendered data fresh: listens to the SSE stream and refreshes on each update.
 * If the stream drops, it shows a notice and falls back to polling until it reconnects.
 */
export function RealtimeRefresher({ caseId }: { caseId?: string }) {
  const router = useRouter();
  const { d } = useI18n();
  const [offline, setOffline] = useState(false);
  const lastRefresh = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < 800) return;
      lastRefresh.current = now;
      router.refresh();
    };

    if (process.env.NEXT_PUBLIC_REALTIME === "poll") {
      // Lightweight polling: compare an activity stamp and refresh only when something changed.
      let last: string | null = null;
      let failures = 0;
      const check = async () => {
        if (document.visibilityState !== "visible") return;
        try {
          const res = await fetch(`/api/realtime?mode=stamp${caseId ? `&case=${caseId}` : ""}`, { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          const { stamp } = (await res.json()) as { stamp: string };
          if (last !== null && stamp !== last) refresh();
          last = stamp;
          failures = 0;
          setOffline(false);
        } catch {
          if (++failures >= 2) setOffline(true);
        }
      };
      void check();
      const timer = setInterval(check, 8000);
      const onFocus = () => void check();
      window.addEventListener("focus", onFocus);
      return () => {
        clearInterval(timer);
        window.removeEventListener("focus", onFocus);
      };
    }

    const es = new EventSource(`/api/realtime${caseId ? `?case=${caseId}` : ""}`);
    let fallback: ReturnType<typeof setInterval> | undefined;
    es.addEventListener("ready", () => {
      setOffline(false);
      if (fallback) clearInterval(fallback);
      fallback = undefined;
    });
    es.addEventListener("update", refresh);
    es.onerror = () => {
      setOffline(true);
      if (!fallback) fallback = setInterval(refresh, 15000);
    };
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      es.close();
      if (fallback) clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
    };
  }, [caseId, router]);

  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900">
      <WifiOff className="size-3.5" aria-hidden />
      {d.states.offline}
    </div>
  );
}
