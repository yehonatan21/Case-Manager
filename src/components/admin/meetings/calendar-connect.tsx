"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, Unplug } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

/** Connect or disconnect the signed-in team member's Google Calendar. */
export function CalendarConnect({
  status,
  available,
  result,
  returnTo = "/admin/meetings",
}: {
  status: { connected: boolean; email: string | null; lastError: string | null };
  available: boolean;
  result?: string;
  /** Page to come back to after Google's consent screen. */
  returnTo?: string;
}) {
  const { d } = useI18n();
  const t = d.meetings;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const resultText = result && result in t.calendarResult ? t.calendarResult[result as keyof typeof t.calendarResult] : null;

  const disconnect = async () => {
    setBusy(true);
    try {
      await api("/api/integrations/google-calendar", { method: "DELETE" });
      toast("success", t.calendarDisconnected);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-3 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
              <CalendarCheck2 className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">{t.calendarTitle}</h2>
              <p className="text-sm text-slate-600">{t.calendarHint}</p>
            </div>
          </div>
          {status.connected && <Badge tone="success">{fmt(t.calendarConnected, { email: status.email ?? "" })}</Badge>}
        </div>
        {resultText && <Notice tone={result === "connected" ? "success" : "warning"}>{resultText}</Notice>}
        {status.lastError && <p className="text-xs text-amber-800">{fmt(t.calendarError, { error: status.lastError })}</p>}
        {!available ? (
          <p className="text-sm text-slate-600">{t.calendarUnavailable}</p>
        ) : status.connected ? (
          <div>
            <Button variant="outline" loading={busy} onClick={disconnect}>
              <Unplug className="size-4" aria-hidden /> {t.calendarDisconnect}
            </Button>
          </div>
        ) : (
          <div>
            <a href={`/api/integrations/google-calendar/connect?next=${encodeURIComponent(returnTo)}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
              <CalendarCheck2 className="size-4" aria-hidden /> {t.calendarConnect}
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
