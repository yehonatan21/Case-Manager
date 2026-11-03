"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useActionText } from "@/components/case/client-actions";
import type { ClientAction } from "@/lib/services/cases";

export function PortalActions({ items }: { items: { caseId: string; caseTitle: string; number: string; action: ClientAction }[] }) {
  const { d } = useI18n();
  const actionText = useActionText();
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
        <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
        {d.portal.noActions}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((it, i) => {
        const t = actionText(it.action);
        return (
          <li key={i}>
            <Link href={`/portal/cases/${it.caseId}?tab=${t.tab}`} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 transition hover:border-amber-300">
              <span className="flex min-w-0 items-start gap-3">
                <t.icon className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900">{t.title}</span>
                  <span className="bidi-auto block truncate text-sm text-slate-600">
                    {it.caseTitle} · <span dir="ltr">{it.number}</span>
                  </span>
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700">
                {t.cta}
                <ArrowRight className="size-4 flip-rtl" aria-hidden />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
