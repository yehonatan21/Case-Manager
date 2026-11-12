"use client";

import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Report charts: one series each, in a single hue (the brand's indigo, validated against the card surface), so the
 * title names the series and there's no legend. Bars are thin with a 4px rounded data-end, grow from one baseline,
 * and carry their value as text in ink colors (never the bar color). Every bar is focusable with a tooltip, and
 * every chart has a table view.
 */
export type BarDatum = { key: string; label: string; value: number; display: string; detail?: string };

const BAR = "#4f46e5";

function Tooltip({ d, id }: { d: BarDatum; id: string }) {
  return (
    <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full start-0 z-10 mb-1.5 w-max max-w-[16rem] rounded-md bg-inverse px-2.5 py-1.5 text-xs text-white shadow-lg">
      <span className="block font-medium">{d.label}</span>
      <span className="block tabular-nums">{d.display}</span>
      {d.detail && <span className="block text-slate-300">{d.detail}</span>}
    </span>
  );
}

function TableView({ data, labelHeader, valueHeader }: { data: BarDatum[]; labelHeader: string; valueHeader: string }) {
  const { d } = useI18n();
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">{d.reports.showTable}</summary>
      <table className="mt-2 w-full text-start">
        <thead className="text-xs text-slate-500">
          <tr>
            <th className="py-1 text-start font-medium">{labelHeader}</th>
            <th className="py-1 text-end font-medium">{valueHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((x) => (
            <tr key={x.key}>
              <td className="bidi-auto py-1">{x.label}</td>
              <td className="py-1 text-end tabular-nums">
                {x.display}
                {x.detail && <span className="text-slate-500"> · {x.detail}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Ranked horizontal bars (largest first): compare parts, read long labels. */
export function HBarChart({ data, labelHeader, valueHeader, empty }: { data: BarDatum[]; labelHeader: string; valueHeader: string; empty: string }) {
  const [active, setActive] = useState<string | null>(null);
  const uid = useId();
  if (data.length === 0 || data.every((x) => x.value === 0)) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...data.map((x) => x.value), 1);
  return (
    <div>
      <ul className="space-y-2.5">
        {data.map((x) => (
          <li
            key={x.key}
            tabIndex={0}
            aria-label={`${x.label}: ${x.display}${x.detail ? `, ${x.detail}` : ""}`}
            aria-describedby={active === x.key ? `${uid}-${x.key}` : undefined}
            onMouseEnter={() => setActive(x.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(x.key)}
            onBlur={() => setActive(null)}
            className="relative grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <span className="bidi-auto truncate text-sm text-slate-700">{x.label}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn("h-4 shrink-0 rounded-e-[4px] transition-opacity", active && active !== x.key && "opacity-60")}
                style={{ width: `max(2px, calc((100% - 6rem) * ${x.value / max}))`, background: BAR }}
              />
              <span className="whitespace-nowrap text-xs font-medium tabular-nums text-slate-700">{x.display}</span>
            </span>
            {active === x.key && <Tooltip d={x} id={`${uid}-${x.key}`} />}
          </li>
        ))}
      </ul>
      <TableView data={data} labelHeader={labelHeader} valueHeader={valueHeader} />
    </div>
  );
}

/** Columns over time (e.g. revenue per month), on one baseline; values show on hover/focus and in the table. */
export function ColumnChart({ data, labelHeader, valueHeader, empty }: { data: BarDatum[]; labelHeader: string; valueHeader: string; empty: string }) {
  const [active, setActive] = useState<string | null>(null);
  const uid = useId();
  if (data.length === 0 || data.every((x) => x.value === 0)) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...data.map((x) => x.value), 1);
  const top = data.reduce((a, b) => (b.value > a.value ? b : a));
  // Selective direct labels: the highest and the latest column only.
  const labelled = new Set([top.key, data.at(-1)!.key]);
  return (
    <div>
      <div role="list" className="flex h-48 items-end gap-1 border-b border-slate-300 pt-6" dir="ltr">
        {data.map((x) => (
          <div
            key={x.key}
            role="listitem"
            tabIndex={0}
            aria-label={`${x.label}: ${x.display}${x.detail ? `, ${x.detail}` : ""}`}
            aria-describedby={active === x.key ? `${uid}-${x.key}` : undefined}
            onMouseEnter={() => setActive(x.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(x.key)}
            onBlur={() => setActive(null)}
            className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {labelled.has(x.key) && x.value > 0 && <span className="mb-1 whitespace-nowrap text-[11px] font-medium tabular-nums text-slate-700">{x.display}</span>}
            <span
              aria-hidden
              className={cn("w-full max-w-6 rounded-t-[4px] transition-opacity", active && active !== x.key && "opacity-60")}
              style={{ height: `${x.value > 0 ? Math.max(2, (x.value / max) * 100) : 0}%`, background: BAR, maxHeight: "calc(100% - 1.25rem)" }}
            />
            {active === x.key && <Tooltip d={x} id={`${uid}-${x.key}`} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] text-slate-500" dir="ltr" aria-hidden>
        {data.map((x, i) => (
          <span key={x.key} className="min-w-0 flex-1 truncate text-center">
            {data.length <= 12 || i % Math.ceil(data.length / 12) === 0 ? x.label : ""}
          </span>
        ))}
      </div>
      <TableView data={data} labelHeader={labelHeader} valueHeader={valueHeader} />
    </div>
  );
}

/** A headline number. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card bg-card shadow-card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
