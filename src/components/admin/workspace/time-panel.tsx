"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Plus, Square, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDate, formatMoney } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { hhmm } from "@/lib/reports-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

type Summary = {
  entries: { id: string; userId: string; userName: string; date: string; minutes: number | null; startedAt: string | null; note: string; billable: boolean }[];
  expenses: { id: string; date: string; description: string; amountCents: number; currency: string; createdById: string | null }[];
  minutes: number;
  billableMinutes: number;
  running: { id: string; startedAt: string } | null;
  money: null | { currency: string; revenueCents: number; laborCents: number; expensesCents: number; profitCents: number; marginPct: number | null; unratedMinutes: number };
  canManageAll: boolean;
};

const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/** Time on a case (timer and manual entries), expenses, and — for admins and finance — the case's profit. */
export function TimePanel({ caseId, currentUserId, canEdit, currency }: { caseId: string; currentUserId: string; canEdit: boolean; currency: string }) {
  const { d, locale } = useI18n();
  const t = d.time;
  const toast = useToast();
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [entry, setEntry] = useState({ hours: "", minutes: "", date: todayLocal(), note: "", billable: true });
  const [stopNote, setStopNote] = useState("");
  const [expense, setExpense] = useState({ description: "", amount: "", date: todayLocal() });

  const load = useCallback(async () => {
    try {
      setS(await api<Summary>(`/api/cases/${caseId}/time`));
    } catch (e) {
      toast("error", errorText(e, d));
    }
  }, [caseId, d, toast]);
  useEffect(() => void load(), [load]);
  // The running timer's clock.
  useEffect(() => {
    if (!s?.running) return;
    const i = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(i);
  }, [s?.running]);

  const call = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    try {
      await fn();
      after?.();
      await load();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <p className="py-6 text-center text-sm text-slate-500">{d.common.loading}</p>;
  const runningMin = s.running ? Math.max(0, Math.floor((now - new Date(s.running.startedAt).getTime()) / 60000)) : 0;
  const mins = (Number(entry.hours) || 0) * 60 + (Number(entry.minutes) || 0);
  const money = (c: number) => formatMoney(c, s.money?.currency ?? currency, locale);

  return (
    <div className="space-y-4">
      {s.money && (
        <Card>
          <CardHeader>
            <CardTitle as="h3">{t.profit}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {[
                [t.revenue, money(s.money.revenueCents)],
                [t.labor, money(s.money.laborCents)],
                [t.expensesCost, money(s.money.expensesCents)],
                [t.profit, money(s.money.profitCents)],
                [t.margin, s.money.marginPct == null ? "—" : `${s.money.marginPct}%`],
              ].map(([k, v], i) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className={`font-semibold tabular-nums ${i === 3 ? (s.money!.profitCents < 0 ? "text-red-700" : "text-emerald-700") : "text-slate-900"}`} dir="ltr">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {s.money.unratedMinutes > 0 && <p className="mt-2 text-xs text-amber-800">{fmt(t.unrated, { time: hhmm(s.money.unratedMinutes) })}</p>}
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {s.running ? (
            <>
              <span role="timer" aria-live="off" className="font-mono text-sm font-semibold text-brand-800">
                {fmt(t.running, { time: hhmm(runningMin) })}
              </span>
              <Input aria-label={t.stopNote} placeholder={t.stopNote} value={stopNote} maxLength={500} onChange={(e) => setStopNote(e.target.value)} className="min-w-48 flex-1" />
              <Button loading={busy === "stop"} onClick={() => call("stop", () => api(`/api/cases/${caseId}/time`, { body: { action: "stop", note: stopNote } }), () => setStopNote(""))}>
                <Square className="size-4" aria-hidden /> {t.stop}
              </Button>
            </>
          ) : (
            <Button variant="outline" loading={busy === "start"} onClick={() => call("start", () => api(`/api/cases/${caseId}/time`, { body: { action: "start" } }))}>
              <Play className="size-4 flip-rtl" aria-hidden /> {t.start}
            </Button>
          )}
        </div>
      )}

      {canEdit && (
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">{t.addTitle}</legend>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t.hours} className="w-20">{(p) => <Input {...p} type="number" min={0} max={24} dir="ltr" value={entry.hours} onChange={(e) => setEntry({ ...entry, hours: e.target.value })} />}</Field>
            <Field label={t.minutes} className="w-20">{(p) => <Input {...p} type="number" min={0} max={59} dir="ltr" value={entry.minutes} onChange={(e) => setEntry({ ...entry, minutes: e.target.value })} />}</Field>
            <Field label={t.date}>{(p) => <Input {...p} type="date" dir="ltr" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />}</Field>
            <Field label={t.note} className="min-w-40 flex-1">{(p) => <Input {...p} value={entry.note} maxLength={500} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />}</Field>
            <Checkbox label={t.billable} checked={entry.billable} onChange={(e) => setEntry({ ...entry, billable: e.target.checked })} className="mb-2" />
            <Button
              loading={busy === "add"}
              disabled={mins < 1 || mins > 1440 || !entry.date}
              onClick={() =>
                call("add", () => api(`/api/cases/${caseId}/time`, { body: { action: "add", minutes: mins, date: entry.date, note: entry.note, billable: entry.billable } }), () =>
                  setEntry({ ...entry, hours: "", minutes: "", note: "" }),
                )
              }
            >
              <Plus className="size-4" aria-hidden /> {t.add}
            </Button>
          </div>
        </fieldset>
      )}

      <section aria-labelledby="time-entries-title">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="time-entries-title" className="text-sm font-semibold">
            {t.entries}
          </h3>
          <p className="text-xs text-slate-600">
            {fmt(t.total, { time: hhmm(s.minutes) })} · {fmt(t.billableTotal, { time: hhmm(s.billableMinutes) })}
          </p>
        </div>
        {s.entries.filter((e) => e.minutes != null).length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {s.entries
              .filter((e) => e.minutes != null)
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-14 font-mono font-semibold tabular-nums" dir="ltr">
                    {hhmm(e.minutes!)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="bidi-auto text-slate-900">{e.note || "—"}</span>
                    <span className="block text-xs text-slate-500">
                      {e.userName} · {formatDate(e.date, locale)}
                      {!e.billable && <> · {t.nonBillable}</>}
                    </span>
                  </span>
                  {canEdit && (e.userId === currentUserId || s.canManageAll) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={fmt(t.deleteEntry, { date: formatDate(e.date, locale) })}
                      disabled={busy === e.id}
                      onClick={() => confirm(t.deleteConfirm) && call(e.id, () => api(`/api/time/${e.id}`, { method: "DELETE" }))}
                    >
                      <Trash2 className="size-4 text-slate-500" />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="expenses-title">
        <h3 id="expenses-title" className="mb-1.5 text-sm font-semibold">
          {t.expenses}
        </h3>
        {s.expenses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">{t.expensesEmpty}</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {s.expenses.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="bidi-auto text-slate-900">{x.description}</span>
                  <span className="block text-xs text-slate-500">{formatDate(x.date, locale)}</span>
                </span>
                <span className="font-semibold tabular-nums" dir="ltr">
                  {formatMoney(x.amountCents, x.currency, locale)}
                </span>
                <Button variant="ghost" size="icon" aria-label={fmt(t.deleteExpense, { name: x.description })} disabled={busy === x.id} onClick={() => call(x.id, () => api(`/api/expenses/${x.id}`, { method: "DELETE" }))}>
                  <Trash2 className="size-4 text-slate-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label={t.expenseDesc} className="min-w-48 flex-1">{(p) => <Input {...p} value={expense.description} maxLength={300} onChange={(e) => setExpense({ ...expense, description: e.target.value })} />}</Field>
          <Field label={t.amount} className="w-28">{(p) => <Input {...p} type="number" min={0} step="0.01" dir="ltr" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} />}</Field>
          <Field label={t.date}>{(p) => <Input {...p} type="date" dir="ltr" value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} />}</Field>
          <Button
            variant="outline"
            loading={busy === "expense"}
            disabled={!expense.description.trim() || !(Number(expense.amount) > 0) || !expense.date}
            onClick={() =>
              call("expense", () => api(`/api/cases/${caseId}/expenses`, { body: { description: expense.description, amountCents: Math.round(Number(expense.amount) * 100), date: expense.date, currency } }), () =>
                setExpense({ ...expense, description: "", amount: "" }),
              )
            }
          >
            <Plus className="size-4" aria-hidden /> {t.addExpense}
          </Button>
        </div>
      </section>
    </div>
  );
}
