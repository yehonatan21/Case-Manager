"use client";

import { ClipboardList } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { IntakeSummary } from "@/lib/db/schema";
import { useCategories } from "@/components/app/categories";

/** Live "what we understood so far" card, updated after each turn. */
export function UnderstoodCard({ summary }: { summary: IntakeSummary | null }) {
  const { d } = useI18n();
  const categories = useCategories();
  const has = summary && (summary.request_title || summary.known_facts.length);
  return (
    <div className="rounded-card bg-card shadow-card p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ClipboardList className="size-4 text-brand-700" aria-hidden />
        {d.intake.understoodTitle}
      </div>
      {!has ? (
        <p className="mt-3 text-sm text-slate-500">{d.intake.understoodEmpty}</p>
      ) : (
        <dl className="mt-4 space-y-3 text-sm">
          {summary!.request_title && (
            <div>
              <dt className="text-xs text-slate-500">{d.review.requestTitle}</dt>
              <dd className="bidi-auto font-medium text-slate-900">{summary!.request_title}</dd>
            </div>
          )}
          {summary!.customer_goal && (
            <div>
              <dt className="text-xs text-slate-500">{d.review.goal}</dt>
              <dd className="bidi-auto text-slate-700">{summary!.customer_goal}</dd>
            </div>
          )}
          {summary!.known_facts.length > 0 && (
            <div>
              <dt className="text-xs text-slate-500">{d.review.knownFacts}</dt>
              <dd>
                <ul className="mt-1 space-y-1">
                  {summary!.known_facts.map((f, i) => (
                    <li key={i} className="bidi-auto text-slate-700">
                      <span className="text-slate-500">{f.label}:</span> {f.value}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {summary!.missing_information.length > 0 && (
            <div>
              <dt className="text-xs text-slate-500">{d.review.missingInfo}</dt>
              <dd>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-800 marker:text-amber-400">
                  {summary!.missing_information.map((m, i) => (
                    <li key={i} className="bidi-auto">
                      {m}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-slate-500">{d.review.category}</dt>
            <dd className="text-slate-700">{categories.label(summary!.service_category)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
