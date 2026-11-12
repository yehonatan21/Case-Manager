import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Lists on phones: the wide tables (which needed sideways scrolling) become a column of cards below the `md`
 * breakpoint. Each card leads with the record's title as its link, its status beside it, and a few labelled
 * details; the whole card opens the record. The table is still used from `md` up (pair it with `TableFrame`).
 */
export function CardList({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={cn("space-y-3 md:hidden", className)} data-cards>
      {children}
    </ul>
  );
}

/** The wide table, shown from `md` up (the cards take its place on phones). */
export function TableFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("hidden overflow-x-auto rounded-card bg-card shadow-card md:block", className)}>{children}</div>;
}

export type CardDetail = { label: string; value: React.ReactNode; wide?: boolean } | null | false | "" | 0 | undefined;

export function RecordCard({
  href,
  title,
  eyebrow,
  status,
  details = [],
  footer,
}: {
  /** Opens the record; the whole card is clickable. Without it the card is plain (its footer holds the actions). */
  href?: string;
  title: React.ReactNode;
  /** A short line above the title, e.g. the case number. */
  eyebrow?: React.ReactNode;
  status?: React.ReactNode;
  details?: CardDetail[];
  /** Actions of their own (they sit above the card's link, so they stay clickable). */
  footer?: React.ReactNode;
}) {
  const shown = details.filter(Boolean) as Exclude<CardDetail, null | false | "" | 0 | undefined>[];
  return (
    <li className="relative rounded-card bg-card shadow-card p-4 has-[a[data-card-link]:hover]:border-brand-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-0.5 text-xs text-slate-600">{eyebrow}</div>}
          <h2 className="text-sm font-semibold text-slate-900">
            {href ? (
              <Link
                href={href}
                data-card-link
                className="bidi-auto outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:text-brand-700 focus-visible:after:outline-2 focus-visible:after:outline-brand-600"
              >
                {title}
              </Link>
            ) : (
              <span className="bidi-auto">{title}</span>
            )}
          </h2>
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
      {shown.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {shown.map((x, i) => (
            <div key={i} className={cn("min-w-0", x.wide && "col-span-2")}>
              <dt className="text-xs text-slate-500">{x.label}</dt>
              <dd className="truncate text-slate-800">{x.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {footer && <div className="relative z-10 mt-3 border-t border-slate-100 pt-3">{footer}</div>}
    </li>
  );
}
