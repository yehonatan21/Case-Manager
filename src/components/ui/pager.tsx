import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/dictionaries";

/** Previous / next links for a server-rendered list; keeps the other query parameters. */
export function Pager({ d, page, pages, hasNext, basePath, params }: { d: Dict; page: number; pages?: number; hasNext?: boolean; basePath: string; params: Record<string, string | undefined> }) {
  const next = pages ? page < pages : !!hasNext;
  if (page <= 1 && !next) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const link = "inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50";
  return (
    <nav aria-label={d.admin.pagination} className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={link} rel="prev">
          <ChevronRight className="size-4 ltr:rotate-180" aria-hidden />
          {d.admin.pagePrev}
        </Link>
      ) : (
        <span />
      )}
      {pages ? <span className="text-sm text-slate-600">{fmt(d.admin.pageOf, { page, pages })}</span> : null}
      {next ? (
        <Link href={href(page + 1)} className={link} rel="next">
          {d.admin.pageNext}
          <ChevronLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
