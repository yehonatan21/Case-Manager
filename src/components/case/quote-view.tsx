"use client";

import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatMoney } from "@/lib/i18n/format";
import { QuoteStatusBadge } from "@/components/app/status";
import type { QuoteStatus } from "@/lib/db/schema";

export type QuoteViewData = {
  version: number;
  status: QuoteStatus;
  expired?: boolean;
  serviceName: string;
  scope: string;
  included: string;
  excluded: string;
  currency: string;
  taxRate: string | number;
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentTerms: string;
  timeline: string;
  terms: string;
  validUntil: string | null;
  items: { description: string; quantity: string | number; unitPriceCents: number }[];
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** The quote as the customer sees it (also used for the staff preview). */
export function QuoteView({ q }: { q: QuoteViewData }) {
  const { d, locale } = useI18n();
  const money = (c: number) => formatMoney(c, q.currency, locale);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {d.quote.title} · {fmt(d.quote.version, { n: q.version })}
          </p>
          <h3 className="bidi-auto mt-1 text-lg font-bold text-slate-900">{q.serviceName || "—"}</h3>
        </div>
        <QuoteStatusBadge status={q.status} expired={q.expired} />
      </div>
      <div className="space-y-5 p-5 text-sm">
        {q.scope && (
          <section>
            <h4 className="font-semibold text-slate-800">{d.quote.scope}</h4>
            <p className="bidi-auto mt-1 whitespace-pre-line leading-relaxed text-slate-700">{q.scope}</p>
          </section>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {lines(q.included).length > 0 && (
            <section>
              <h4 className="font-semibold text-slate-800">{d.quote.included}</h4>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-700 marker:text-emerald-500">
                {lines(q.included).map((l, i) => (
                  <li key={i} className="bidi-auto">{l}</li>
                ))}
              </ul>
            </section>
          )}
          {lines(q.excluded).length > 0 && (
            <section>
              <h4 className="font-semibold text-slate-800">{d.quote.excluded}</h4>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-700 marker:text-slate-500">
                {lines(q.excluded).map((l, i) => (
                  <li key={i} className="bidi-auto">{l}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section>
          <h4 className="mb-2 font-semibold text-slate-800">{d.quote.items}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2 text-start font-medium">{d.quote.item}</th>
                  <th className="py-2 text-end font-medium">{d.quote.quantity}</th>
                  <th className="py-2 text-end font-medium">{d.quote.unitPrice}</th>
                  <th className="py-2 text-end font-medium">{d.quote.lineTotal}</th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="bidi-auto py-2 text-slate-800">{it.description}</td>
                    <td className="py-2 text-end tabular-nums">{Number(it.quantity)}</td>
                    <td className="py-2 text-end tabular-nums">{money(it.unitPriceCents)}</td>
                    <td className="py-2 text-end tabular-nums">{money(Math.round(Number(it.quantity) * it.unitPriceCents))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-slate-700">
                <tr>
                  <td colSpan={3} className="pt-3 text-end">{d.quote.subtotal}</td>
                  <td className="pt-3 text-end tabular-nums">{money(q.subtotalCents)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="py-1 text-end">{fmt(d.quote.vat, { rate: Number(q.taxRate) })}</td>
                  <td className="py-1 text-end tabular-nums">{money(q.taxCents)}</td>
                </tr>
                <tr className="text-base font-bold text-slate-900">
                  <td colSpan={3} className="pt-2 text-end">{d.quote.total}</td>
                  <td className="pt-2 text-end tabular-nums">{money(q.totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        <dl className="grid gap-4 sm:grid-cols-2">
          {q.paymentTerms && (
            <div>
              <dt className="font-semibold text-slate-800">{d.quote.paymentTerms}</dt>
              <dd className="bidi-auto mt-1 whitespace-pre-line text-slate-700">{q.paymentTerms}</dd>
            </div>
          )}
          {q.timeline && (
            <div>
              <dt className="font-semibold text-slate-800">{d.quote.timeline}</dt>
              <dd className="bidi-auto mt-1 whitespace-pre-line text-slate-700">{q.timeline}</dd>
            </div>
          )}
        </dl>
        {q.terms && (
          <section>
            <h4 className="font-semibold text-slate-800">{d.quote.terms}</h4>
            <p className="bidi-auto mt-1 whitespace-pre-line text-slate-600">{q.terms}</p>
          </section>
        )}
        {q.validUntil && (
          <p className={q.expired ? "font-medium text-red-700" : "text-slate-500"}>
            {fmt(q.expired ? d.quote.expired : d.quote.validUntil, { date: formatDate(q.validUntil, locale) })}
          </p>
        )}
      </div>
    </div>
  );
}
