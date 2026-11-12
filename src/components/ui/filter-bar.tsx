import Link from "next/link";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/dictionaries";
import { DateInput } from "./date-input";
import { fieldBase } from "./form";
import { cn } from "@/lib/utils";

/**
 * The filter bar shared by the staff lists (Quotes, Payments, Tasks): a plain GET form, so the filters live in the
 * URL — a filtered list can be bookmarked, shared, reloaded, and Back returns to it. Each field has a visible
 * label. "Clear filters" keeps only the `keep` values (e.g. the tab the list is on). The results count is
 * announced when it changes.
 */
export type FilterField =
  | { type: "search"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[]; any?: string | false }
  | { type: "date"; name: string; label: string; /** One end of a From/To pair (the calendar shades the days between). */ range?: "from" | "to" }
  | { type: "amount"; name: string; label: string };

type Values = Record<string, string | undefined>;

export function FilterBar({ d, basePath, fields, values, keep = {}, total }: { d: Dict; basePath: string; fields: FilterField[]; values: Values; keep?: Values; total: number }) {
  const t = d.filterBar;
  const active = fields.some((f) => !!values[f.name]);
  const clearQs = new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as [string, string][]).toString();
  const id = (name: string) => `filter-${name}`;
  return (
    <div className="mb-4">
      <form method="get" action={basePath} role="search" aria-label={t.label} className="flex flex-wrap items-end gap-3 rounded-card bg-card shadow-card p-3 sm:p-4">
        {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {fields.map((f) => (
          <div key={f.name} className={cn("grid min-w-0 gap-1 text-sm", f.type === "search" ? "grow-[3] basis-64" : "grow basis-36 sm:max-w-60")}>
            <label htmlFor={id(f.name)} className="font-medium text-slate-700">
              {f.label}
            </label>
            {f.type === "search" && <input id={id(f.name)} name={f.name} type="search" defaultValue={values[f.name] ?? ""} placeholder={f.placeholder} className={cn(fieldBase, "h-10")} />}
            {f.type === "select" && (
              <select id={id(f.name)} name={f.name} defaultValue={values[f.name] ?? ""} className={cn(fieldBase, "h-10 pe-8")}>
                {f.any !== false && <option value="">{f.any ?? t.any}</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            {f.type === "date" && <DateInput id={id(f.name)} name={f.name} defaultValue={values[f.name] ?? ""} range={f.range ? { group: basePath, part: f.range } : undefined} />}
            {f.type === "amount" && <input id={id(f.name)} name={f.name} type="text" inputMode="decimal" dir="ltr" defaultValue={values[f.name] ?? ""} className={cn(fieldBase, "h-10 text-start")} />}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="submit" className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong">
            {t.apply}
          </button>
          {active && (
            <Link href={clearQs ? `${basePath}?${clearQs}` : basePath} className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
              {t.clear}
            </Link>
          )}
        </div>
      </form>
      <p className="mt-2 text-sm text-slate-600" role="status">
        {fmt(t.results, { n: total })}
      </p>
    </div>
  );
}
