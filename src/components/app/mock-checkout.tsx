"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, FlaskConical, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

export function MockCheckout(p: { paymentId: string; caseId: string; status: string; amountCents: number; currency: string; service: string; caseNumber: string }) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const back = (q: string) => `/portal/cases/${p.caseId}?tab=quote&payment=${q}`;

  const finish = async (outcome: "succeeded" | "failed" | "cancelled") => {
    setBusy(outcome);
    setError(null);
    try {
      await api(`/api/payments/mock/${p.paymentId}`, { body: { outcome } });
      router.push(back(outcome === "succeeded" ? "success" : outcome === "cancelled" ? "cancelled" : "failed"));
    } catch (e) {
      setError(errorText(e, d));
      setBusy(null);
    }
  };

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <p className="flex items-center gap-2 font-semibold">
          <Lock className="size-4" aria-hidden /> {d.mockPay.title}
        </p>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">
          <FlaskConical className="size-3" aria-hidden /> TEST
        </span>
      </div>
      <div className="space-y-5 p-6">
        <Notice tone="warning">{d.mockPay.testMode}</Notice>
        <div>
          <p className="text-sm text-slate-500">{d.mockPay.amount}</p>
          <p className="text-3xl font-bold tabular-nums">{formatMoney(p.amountCents, p.currency, locale)}</p>
          <p className="bidi-auto mt-1 text-sm text-slate-600">
            {fmt(d.mockPay.for, { service: p.service })} · <span dir="ltr">{p.caseNumber}</span>
          </p>
        </div>
        {p.status !== "pending" ? (
          <Notice tone="info" action={<Button size="sm" onClick={() => router.push(back("success"))}>{d.common.back}</Button>}>
            {d.mockPay.alreadyDone}
          </Notice>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="card">
                {d.mockPay.card}
              </label>
              <div className="relative">
                <CreditCard className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input id="card" dir="ltr" defaultValue="4242 4242 4242 4242" className="ps-9 font-mono" readOnly />
              </div>
            </div>
            <Button size="lg" className="w-full" onClick={() => finish("succeeded")} loading={busy === "succeeded"} disabled={!!busy}>
              {busy === "succeeded" ? d.mockPay.processing : `${d.mockPay.pay} ${formatMoney(p.amountCents, p.currency, locale)}`}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => finish("failed")} loading={busy === "failed"} disabled={!!busy}>
                {d.mockPay.fail}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={() => finish("cancelled")} loading={busy === "cancelled"} disabled={!!busy}>
                {d.mockPay.cancel}
              </Button>
            </div>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </div>
  );
}
