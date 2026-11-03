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
