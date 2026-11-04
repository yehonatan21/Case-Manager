"use client";

import { RelativeTime } from "@/components/ui/relative-time";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { CaseStatusBadge, UrgencyBadge } from "@/components/app/status";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { normalizeCategory } from "@/lib/domain";
import type { CaseStatus, Urgency } from "@/lib/db/schema";

export type CaseRow = {
  id: string;
  number: string;
  title: string;
  status: CaseStatus;
  urgency: Urgency;
  serviceCategory: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  assigneeName: string | null;
  customerName: string;
  missingCount: number;
  hasAiSummary: boolean;
};

export function CasesTable({ rows, variant, empty }: { rows: CaseRow[]; variant: "inbox" | "cases"; empty: string }) {
  const { d, locale } = useI18n();
  const router = useRouter();
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.number}</th>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.customer}</th>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.title}</th>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.category}</th>
            <th className="px-4 py-3 text-start font-medium">{variant === "inbox" ? d.admin.col.received : d.admin.col.updated}</th>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.urgency}</th>
            {variant === "inbox" && <th className="px-4 py-3 text-start font-medium">{d.admin.col.missing}</th>}
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.assignee}</th>
            <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => router.push(`/admin/cases/${r.id}`)}>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">
                <Link href={`/admin/cases/${r.id}`} className="hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {r.number}
                </Link>
              </td>
              <td className="bidi-auto px-4 py-3 text-slate-800">{r.customerName}</td>
              <td className="px-4 py-3">
                <span className="bidi-auto font-medium text-slate-900">{r.title}</span>
                {r.hasAiSummary && <Bot className="ms-1.5 inline size-3.5 text-brand-500" aria-label={d.copilot.summaryTitle} />}
              </td>
              <td className="px-4 py-3 text-slate-600">{d.categories[normalizeCategory(r.serviceCategory)]}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600"><RelativeTime value={variant === "inbox" ? r.createdAt : r.updatedAt} /></td>
              <td className="px-4 py-3">
                <UrgencyBadge urgency={r.urgency} />
              </td>
              {variant === "inbox" && (
                <td className="px-4 py-3">{r.missingCount > 0 ? <Badge tone="warning">{fmt(d.admin.missingCount, { n: r.missingCount })}</Badge> : <span className="text-slate-500">—</span>}</td>
              )}
              <td className="px-4 py-3 text-slate-600">{r.assigneeName ?? <span className="text-slate-500">{d.common.unassigned}</span>}</td>
              <td className="px-4 py-3">
                <CaseStatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
