"use client";

import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate } from "@/lib/i18n/format";
import { CaseStatusBadge } from "@/components/app/status";
import { useActionText } from "@/components/case/client-actions";
import type { ClientAction } from "@/lib/services/cases";
import type { CaseStatus } from "@/lib/db/schema";

export type CaseCardData = { id: string; number: string; title: string; status: CaseStatus; createdAt: Date; updatedAt: Date; actions: ClientAction[]; unread: number; openedFor?: string | null };

export function CaseCard({ c }: { c: CaseCardData }) {
  const { d, locale } = useI18n();
  const actionText = useActionText();
  const first = c.actions[0] ? actionText(c.actions[0]) : null;
  return (
    <article className="flex flex-col rounded-card bg-card shadow-card p-5 transition hover:shadow-float">
      <div className="flex items-start justify-between gap-3">
        <h3 className="bidi-auto font-semibold leading-snug text-slate-900">{c.title}</h3>
        <CaseStatusBadge status={c.status} audience="client" />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        <span dir="ltr">{c.number}</span> · {fmt(d.portal.openedOn, { date: formatDate(c.createdAt, locale) })}
        {c.openedFor && <> · <span className="bidi-auto">{fmt(d.company.openedFor, { name: c.openedFor })}</span></>}
      </p>
      <p className="mt-3 text-sm text-slate-600">{fmt(d.portal.lastUpdate, { date: formatDate(c.updatedAt, locale) })}</p>
      {first && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          <first.icon className="size-4 shrink-0" aria-hidden />
          {fmt(d.portal.actionLabel, { action: first.title })}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 pt-1">
        {c.unread > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
            <MessageSquare className="size-3.5" aria-hidden /> {fmt(d.portal.unread, { n: c.unread })}
          </span>
        ) : (
          <span />
        )}
        <Link href={`/portal/cases/${c.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
          {d.portal.enterCase}
          <ArrowRight className="size-4 flip-rtl" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
