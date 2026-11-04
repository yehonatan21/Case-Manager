"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatDateTime, formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Notice, EmptyState } from "@/components/ui/misc";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { QuoteView, type QuoteViewData } from "./quote-view";
import type { CaseStatus, PaymentStatusT } from "./types-quote";

export type ClientQuote = QuoteViewData & { id: string; approvedAt: Date | string | null; declinedAt: Date | string | null };
/** How the customer pays: Grow needs name, mobile number and terms approval before opening its page. */
export type CheckoutInfo = { provider: "mock" | "stripe" | "grow"; payerName: string; payerPhone: string };
export type ClientPayment = { id: string; amountCents: number; currency: string; status: PaymentStatusT; createdAt: Date | string; paidAt: Date | string | null };

export function ClientQuotePanel({
  caseId,
  caseStatus,
  quotes,
  payments,
  customerName,
  checkout,
}: {
  caseId: string;
  caseStatus: CaseStatus;
  quotes: ClientQuote[];
  payments: ClientPayment[];
  customerName: string;
  checkout: CheckoutInfo;
}) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"clarify" | "decline" | null>(null);
  const [text, setText] = useState("");
  const [payerOpen, setPayerOpen] = useState(false);
  const [payer, setPayer] = useState({ fullName: checkout.payerName, phone: checkout.payerPhone, acceptTerms: false });

  const current = quotes.find((q) => q.status !== "superseded") ?? quotes[0];
  const previous = quotes.filter((q) => q !== current);
  if (!current) return <EmptyState title={d.quote.noQuote} />;
  const open = (current.status === "sent" || current.status === "clarification_requested") && !current.expired;
  const expired = current.expired || current.status === "expired";

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      toast("error", errorText(e, d));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (checkout.provider === "grow" && !payerOpen) {
      setPayerOpen(true);
      return;
    }
    setBusy("pay");
    try {
      const body = checkout.provider === "grow" ? { quoteId: current.id, payer } : { quoteId: current.id };
      const r = await api<{ url: string }>("/api/payments/checkout", { body });
      window.location.href = r.url;
    } catch (e) {
      toast("error", errorText(e, d));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <QuoteView q={current} />

      {open && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
          <Checkbox label={d.quote.approveConfirm} checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="lg" disabled={!confirm} loading={busy === "approve"} onClick={() => run("approve", () => api(`/api/quotes/${current.id}/approve`, { body: { confirm: true } }))}>
              <CheckCircle2 className="size-4" aria-hidden />
              {d.quote.approve}
            </Button>
            <Button size="lg" variant="outline" onClick={() => setDialog("clarify")}>
              {d.quote.clarify}
            </Button>
            <Button size="lg" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setDialog("decline")}>
              {d.quote.decline}
            </Button>
          </div>
        </div>
      )}

      {expired && (
        <Notice tone="warning" title={d.caseView.actionExpired} action={<Button size="sm" onClick={() => setDialog("clarify")}>{d.caseView.requestNewQuote}</Button>}>
          {d.caseView.actionExpiredText}
        </Notice>
      )}

      {current.status === "approved" && current.approvedAt && (
        <Notice tone="success">{fmt(d.quote.approvedOn, { date: formatDateTime(current.approvedAt, locale), name: customerName })}</Notice>
      )}
      {current.status === "declined" && current.declinedAt && <Notice tone="warning" title={fmt(d.quote.declinedOn, { date: formatDate(current.declinedAt, locale) })} />}

      {current.status === "approved" && caseStatus === "awaiting_payment" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <p className="font-semibold">{d.caseView.actionPay}</p>
            <p className="text-sm text-slate-600">{formatMoney(current.totalCents, current.currency, locale)}</p>
          </div>
          <Button size="lg" onClick={pay} loading={busy === "pay"}>
            <Lock className="size-4" aria-hidden />
            {busy === "pay" ? d.quote.redirecting : d.quote.payNow}
          </Button>
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">{d.quote.paymentsTitle}</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">{d.quote.noPayments}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <CreditCard className="size-4 text-slate-400" aria-hidden />
                  {formatMoney(p.amountCents, p.currency, locale)}
                </span>
                <span className="text-xs text-slate-500">{formatDateTime(p.paidAt ?? p.createdAt, locale)}</span>
                <Badge tone={p.status === "succeeded" ? "success" : p.status === "failed" ? "danger" : "neutral"}>{d.paymentStatus[p.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">{d.quote.receiptsNote}</p>
      </section>

      {previous.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-slate-600">
            {d.quote.previousVersions} ({previous.length})
          </summary>
          <div className="mt-3 space-y-3">
            {previous.map((q) => (
              <QuoteView key={q.id} q={q} />
            ))}
          </div>
        </details>
      )}

      <Dialog
        open={payerOpen}
        onClose={() => setPayerOpen(false)}
        title={d.quote.payerTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayerOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button loading={busy === "pay"} disabled={!payer.acceptTerms || !payer.fullName.trim() || !payer.phone.trim()} onClick={pay}>
              <Lock className="size-4" aria-hidden />
              {busy === "pay" ? d.quote.redirecting : d.quote.payerContinue}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-slate-600">{d.quote.payerIntro}</p>
          <Field label={d.quote.payerFullName} required hint={d.quote.payerFullNameHint}>
            {(p) => <Input {...p} autoComplete="name" value={payer.fullName} maxLength={100} onChange={(e) => setPayer({ ...payer, fullName: e.target.value })} />}
          </Field>
          <Field label={d.quote.payerPhone} required hint={d.quote.payerPhoneHint}>
            {(p) => <Input {...p} type="tel" dir="ltr" autoComplete="tel" inputMode="tel" value={payer.phone} maxLength={30} onChange={(e) => setPayer({ ...payer, phone: e.target.value })} />}
          </Field>
          <Checkbox
            checked={payer.acceptTerms}
            onChange={(e) => setPayer({ ...payer, acceptTerms: e.target.checked })}
            label={
              <>
                {d.quote.payerTermsBefore}{" "}
                <a href="/terms" target="_blank" rel="noopener" className="font-medium text-brand-700 underline">
                  {d.quote.payerTermsLink}
                </a>
              </>
            }
          />
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="size-3.5" aria-hidden />
            {d.quote.payerSecure}
          </p>
        </div>
      </Dialog>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "decline" ? d.quote.declineConfirm : d.quote.clarify}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {d.common.cancel}
            </Button>
            <Button
              variant={dialog === "decline" ? "danger" : "primary"}
              loading={busy === dialog}
              disabled={dialog === "clarify" && !text.trim()}
              onClick={async () => {
                const ok = await run(dialog!, () =>
                  dialog === "decline" ? api(`/api/quotes/${current.id}/decline`, { body: { reason: text || null } }) : api(`/api/quotes/${current.id}/clarify`, { body: { text } }),
                );
                if (ok) {
                  if (dialog === "clarify") toast("success", d.quote.clarifySent);
                  setDialog(null);
                  setText("");
                }
              }}
            >
              {dialog === "decline" ? d.quote.decline : d.common.send}
            </Button>
          </>
        }
      >
        <Field label={dialog === "decline" ? d.quote.declineReason : d.quote.clarifyPrompt} required={dialog === "clarify"}>
          {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} rows={4} className="bidi-auto" />}
        </Field>
      </Dialog>
    </div>
  );
}
