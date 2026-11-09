"use client";

import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Eye, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { QuoteView, type QuoteViewData } from "@/components/case/quote-view";
import { QuoteStatusBadge } from "@/components/app/status";
import type { QuoteStatus } from "@/lib/db/schema";

type Item = { key: string; description: string; quantity: string; price: string; priceListItemId: string | null; needsPrice?: boolean };
export type PriceOption = { id: string; code: string; name: string; unitPriceCents: number; currency: string };

export type EditorQuote = {
  id: string;
  caseId: string;
  caseNumber: string;
  customerName: string;
  version: number;
  status: QuoteStatus;
  expired: boolean;
  serviceName: string;
  scope: string;
  included: string;
  excluded: string;
  currency: string;
  taxRate: string;
  pricesIncludeTax: boolean;
  paymentTerms: string;
  timeline: string;
  terms: string;
  validUntil: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  items: { description: string; quantity: string; unitPriceCents: number; priceListItemId: string | null }[];
};

const toCents = (s: string) => Math.max(0, Math.round((parseFloat(s.replace(/,/g, "")) || 0) * 100));
const keyOf = () => Math.random().toString(36).slice(2);

function totals(items: Item[], rate: number, incl: boolean) {
  const sum = items.reduce((n, i) => n + Math.round((parseFloat(i.quantity) || 0) * toCents(i.price)), 0);
  if (incl) {
    const sub = Math.round(sum / (1 + rate / 100));
    return { subtotalCents: sub, taxCents: sum - sub, totalCents: sum };
  }
  const tax = Math.round((sum * rate) / 100);
  return { subtotalCents: sum, taxCents: tax, totalCents: sum + tax };
}

export function QuoteEditor({ q, priceList, canManage, autoDraft }: { q: EditorQuote; priceList: PriceOption[]; canManage: boolean; autoDraft: boolean }) {
  const { d, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const editable = q.status === "draft" && canManage;

  const [serviceName, setServiceName] = useState(q.serviceName);
  const [scope, setScope] = useState(q.scope);
  const [included, setIncluded] = useState(q.included);
  const [excluded, setExcluded] = useState(q.excluded);
  const [currency, setCurrency] = useState(q.currency);
  const [taxRate, setTaxRate] = useState(q.taxRate);
  const [incl, setIncl] = useState(q.pricesIncludeTax);
  const [paymentTerms, setPaymentTerms] = useState(q.paymentTerms);
  const [timeline, setTimeline] = useState(q.timeline);
  const [terms, setTerms] = useState(q.terms);
  const [validUntil, setValidUntil] = useState(q.validUntil ?? "");
  const [items, setItems] = useState<Item[]>(
    q.items.map((i) => ({ key: keyOf(), description: i.description, quantity: String(Number(i.quantity)), price: (i.unitPriceCents / 100).toFixed(2), priceListItemId: i.priceListItemId })),
  );
  const [aiRunId, setAiRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const autoRan = useRef(false);

  const t = useMemo(() => totals(items, parseFloat(taxRate) || 0, incl), [items, taxRate, incl]);
  const money = (c: number) => formatMoney(c, currency, locale);

  const mark = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };

  const payload = () => ({
    serviceName,
    scope,
    included,
    excluded,
    currency: currency.toUpperCase(),
    taxRate: parseFloat(taxRate) || 0,
    pricesIncludeTax: incl,
    paymentTerms,
    timeline,
    terms,
    validUntil: validUntil || null,
    aiRunId,
    items: items
      .filter((i) => i.description.trim())
      .map((i) => ({ description: i.description, quantity: parseFloat(i.quantity) || 1, unitPriceCents: toCents(i.price), priceListItemId: i.priceListItemId })),
  });

  const save = async (silent = false) => {
    setBusy("save");
    setError(null);
    try {
      await api(`/api/quotes/${q.id}`, { method: "PATCH", body: payload() });
      setDirty(false);
      if (!silent) toast("success", d.common.saved);
      return true;
    } catch (e) {
      setError(errorText(e, d));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (t.totalCents <= 0) {
      setError(d.quoteEditor.zeroTotal);
      return;
    }
    if (!confirm(d.quoteEditor.sendConfirm)) return;
    if (!(await save(true))) return;
    setBusy("send");
    try {
      await api(`/api/quotes/${q.id}/send`, { body: {} });
      toast("success", d.quoteEditor.sent);
      router.push(`/admin/cases/${q.caseId}?tab=quotes`);
      router.refresh();
    } catch (e) {
      setError(errorText(e, d));
      setBusy(null);
    }
  };

  const aiDraft = async () => {
    setBusy("ai");
    setError(null);
    try {
      const r = await api<{
        runId: string;
        draft: { serviceName: string; scope: string; included: string; excluded: string; paymentTerms: string; timeline: string; terms: string; items: { description: string; quantity: number; unitPriceCents: number; priceListItemId: string | null; needsPrice: boolean }[] };
      }>("/api/ai/draft-quote", { body: { caseId: q.caseId } });
      setServiceName(r.draft.serviceName || serviceName);
      setScope(r.draft.scope);
      setIncluded(r.draft.included);
      setExcluded(r.draft.excluded);
      if (r.draft.paymentTerms) setPaymentTerms(r.draft.paymentTerms);
      if (r.draft.timeline) setTimeline(r.draft.timeline);
      if (r.draft.terms) setTerms(r.draft.terms);
      setItems(r.draft.items.map((i) => ({ key: keyOf(), description: i.description, quantity: String(i.quantity), price: (i.unitPriceCents / 100).toFixed(2), priceListItemId: i.priceListItemId, needsPrice: i.needsPrice })));
      setAiRunId(r.runId);
      setDirty(true);
      toast("success", d.quoteEditor.aiDraftApplied);
    } catch (e) {
      setError(`${d.copilot.failed} (${errorText(e, d)})`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (autoDraft && editable && !autoRan.current && q.items.length === 0) {
      autoRan.current = true;
      void aiDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewData: QuoteViewData = {
    version: q.version,
    status: q.status,
    expired: q.expired,
    serviceName,
    scope,
    included,
    excluded,
    currency,
    taxRate: parseFloat(taxRate) || 0,
    pricesIncludeTax: incl,
    paymentTerms,
    timeline,
    terms,
    validUntil: validUntil || null,
    ...t,
    items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, quantity: parseFloat(i.quantity) || 0, unitPriceCents: toCents(i.price) })),
  };

  const header = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <Link href={`/admin/cases/${q.caseId}?tab=quotes`} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="size-3.5 flip-rtl" aria-hidden /> {d.quoteEditor.backToCase}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
          {d.quoteEditor.title} <span className="text-base font-medium text-slate-500">· {fmt(d.quote.version, { n: q.version })}</span>
          <QuoteStatusBadge status={q.status} expired={q.expired} />
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">{fmt(d.quoteEditor.forCase, { number: q.caseNumber, customer: q.customerName })}</p>
      </div>
    </div>
  );

  if (!editable) {
    return (
      <div className="max-w-4xl">
        {header}
        {q.status !== "draft" && <Notice tone="info" className="mb-4">{d.quoteEditor.locked}</Notice>}
        <QuoteView q={previewData} />
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          {preview ? (
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">{d.quoteEditor.previewTitle}</p>
              <QuoteView q={previewData} />
            </div>
          ) : (
            <>
              <Card>
                <CardContent className="space-y-4 py-5">
                  <Field label={d.quoteEditor.serviceName} required>
                    {(p) => <Input {...p} value={serviceName} onChange={(e) => mark(setServiceName)(e.target.value)} className="bidi-auto" />}
                  </Field>
                  <Field label={d.quoteEditor.scope}>{(p) => <Textarea {...p} value={scope} onChange={(e) => mark(setScope)(e.target.value)} rows={5} className="bidi-auto" />}</Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={d.quoteEditor.included}>{(p) => <Textarea {...p} value={included} onChange={(e) => mark(setIncluded)(e.target.value)} rows={4} className="bidi-auto" />}</Field>
                    <Field label={d.quoteEditor.excluded}>{(p) => <Textarea {...p} value={excluded} onChange={(e) => mark(setExcluded)(e.target.value)} rows={4} className="bidi-auto" />}</Field>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{d.quoteEditor.items}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 py-4">
                  {items.map((it, idx) => (
                    <div key={it.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_auto] sm:items-end">
                        <Field label={d.quote.item}>
                          {(p) => (
                            <Input {...p} value={it.description} className="bidi-auto" onChange={(e) => mark(setItems)(items.map((x, j) => (j === idx ? { ...x, description: e.target.value } : x)))} />
                          )}
                        </Field>
                        <Field label={d.quote.quantity}>
                          {(p) => (
                            <Input {...p} type="number" min="0" step="0.5" dir="ltr" value={it.quantity} onChange={(e) => mark(setItems)(items.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))} />
                          )}
                        </Field>
                        <Field label={`${d.quote.unitPrice} (${currency})`}>
                          {(p) => (
                            <Input
                              {...p}
                              type="number"
                              min="0"
                              step="0.01"
                              dir="ltr"
                              value={it.price}
                              aria-invalid={it.needsPrice && toCents(it.price) === 0 ? true : undefined}
                              onChange={(e) => mark(setItems)(items.map((x, j) => (j === idx ? { ...x, price: e.target.value, needsPrice: false } : x)))}
                            />
                          )}
                        </Field>
                        <Button variant="ghost" size="icon" aria-label={d.common.remove} onClick={() => mark(setItems)(items.filter((_, j) => j !== idx))}>
                          <Trash2 className="size-4 text-slate-500" />
                        </Button>
                      </div>
                      {it.needsPrice && toCents(it.price) === 0 && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertTriangle className="size-3.5" aria-hidden /> {d.quoteEditor.needsPrice}
                        </p>
                      )}
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => mark(setItems)([...items, { key: keyOf(), description: "", quantity: "1", price: "0.00", priceListItemId: null }])}>
                      <Plus className="size-4" aria-hidden /> {d.quoteEditor.addItem}
                    </Button>
                    {priceList.length > 0 && (
                      <Select
                        aria-label={d.quoteEditor.fromPriceList}
                        value=""
                        className="h-8 w-auto text-xs"
                        onChange={(e) => {
                          const p = priceList.find((x) => x.id === e.target.value);
                          if (p) mark(setItems)([...items, { key: keyOf(), description: p.name, quantity: "1", price: (p.unitPriceCents / 100).toFixed(2), priceListItemId: p.id }]);
                        }}
                      >
                        <option value="">{d.quoteEditor.choosePriceItem}</option>
                        {priceList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name} · {formatMoney(p.unitPriceCents, p.currency, locale)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                  <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
                    <Field label={d.quoteEditor.currency}>
                      {(p) => (
                        <Select {...p} value={currency} onChange={(e) => mark(setCurrency)(e.target.value)}>
                          {["ILS", "USD", "EUR", "GBP"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={d.quoteEditor.taxRate}>{(p) => <Input {...p} type="number" min="0" max="100" step="0.5" dir="ltr" value={taxRate} onChange={(e) => mark(setTaxRate)(e.target.value)} />}</Field>
                    <div className="flex items-end pb-2">
                      <Checkbox label={d.quoteEditor.pricesIncludeTax} checked={incl} onChange={(e) => mark(setIncl)(e.target.checked)} />
                    </div>
                  </div>
                  <dl className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between">
                      <dt>{d.quote.subtotal}</dt>
                      <dd className="tabular-nums">{money(t.subtotalCents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>{fmt(d.quote.vat, { rate: parseFloat(taxRate) || 0 })}</dt>
                      <dd className="tabular-nums">{money(t.taxCents)}</dd>
                    </div>
                    <div className="flex justify-between text-base font-bold">
                      <dt>{d.quote.total}</dt>
                      <dd className="tabular-nums">{money(t.totalCents)}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="grid gap-4 py-5 md:grid-cols-2">
                  <Field label={d.quoteEditor.paymentTerms}>{(p) => <Textarea {...p} value={paymentTerms} onChange={(e) => mark(setPaymentTerms)(e.target.value)} rows={2} className="bidi-auto" />}</Field>
                  <Field label={d.quoteEditor.timeline}>{(p) => <Textarea {...p} value={timeline} onChange={(e) => mark(setTimeline)(e.target.value)} rows={2} className="bidi-auto" />}</Field>
                  <Field label={d.quoteEditor.terms} className="md:col-span-2">
                    {(p) => <Textarea {...p} value={terms} onChange={(e) => mark(setTerms)(e.target.value)} rows={3} className="bidi-auto" />}
                  </Field>
                  <Field label={d.quoteEditor.validUntil}>{(p) => <DateInput {...p} value={validUntil} onChange={(v) => mark(setValidUntil)(v)} />}</Field>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <aside className="space-y-4">
          <div className="xl:sticky xl:top-20 xl:space-y-4">
            <Card className="border-brand-200">
              <CardContent className="space-y-3 py-4">
                <Button className="w-full" variant="secondary" onClick={aiDraft} loading={busy === "ai"}>
                  <Sparkles className="size-4" aria-hidden /> {busy === "ai" ? d.quoteEditor.aiDrafting : d.quoteEditor.aiDraft}
                </Button>
                <p className="text-xs leading-relaxed text-slate-500">{d.quoteEditor.aiDraftNote}</p>
              </CardContent>
            </Card>
            <Card className="mt-4 xl:mt-0">
              <CardContent className="space-y-2 py-4">
                <p className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-500">{d.quote.total}</span>
                  <span className="text-xl font-bold tabular-nums">{money(t.totalCents)}</span>
                </p>
                <Button className="w-full" variant="outline" onClick={() => setPreview((p) => !p)}>
                  <Eye className="size-4" aria-hidden /> {preview ? d.common.edit : d.common.preview}
                </Button>
                <Button className="w-full" variant="outline" onClick={() => save()} loading={busy === "save"} disabled={!dirty}>
                  {d.quoteEditor.saveDraft}
                </Button>
                <Button className="w-full" size="lg" onClick={send} loading={busy === "send"}>
                  <Send className="size-4 flip-rtl" aria-hidden /> {d.quoteEditor.send}
                </Button>
                {error && <Notice tone="danger">{error}</Notice>}
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
