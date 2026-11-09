import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, History } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime } from "@/lib/i18n/format";
import { getDb } from "@/lib/db";
import { requirePageStaff } from "@/lib/auth/session";
import { activityFilters, listActivity, type ActivityFilter } from "@/lib/services/activity";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Pager } from "@/components/ui/pager";
import { DateInput } from "@/components/ui/date-input";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.activity.title };
}

type SP = { q?: string; actor?: string; group?: string; from?: string; to?: string; page?: string };

const field = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900";

/** Short, readable details of an entry (no ids that mean nothing to a person). */
function summary(details: Record<string, unknown>): string {
  return Object.entries(details ?? {})
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && !/id$|Id$|hash/i.test(k) && typeof v !== "object")
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(" · ");
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageStaff("/admin/activity");
  if (user.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.activity;
  const db = await getDb();
  const filter: ActivityFilter = { q: sp.q, actor: sp.actor, group: sp.group, from: sp.from, to: sp.to, page: Number(sp.page) || 1 };
  const [list, opts] = await Promise.all([listActivity(db, user, filter), activityFilters(db, user)]);
  const params = { q: sp.q, actor: sp.actor, group: sp.group, from: sp.from, to: sp.to };
  const exportHref = `/api/admin/activity/export?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])}`;
  const label = (action: string) => t.actions[action] ?? action;

  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={t.sub}
        actions={
          <a href={exportHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="size-4" aria-hidden /> {t.export}
          </a>
        }
      />
      <form method="get" className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.search}</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t.searchHint} className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.person}</span>
          <select name="actor" defaultValue={sp.actor ?? ""} className={field}>
            <option value="">{t.anyone}</option>
            {opts.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.kind}</span>
          <select name="group" defaultValue={sp.group ?? ""} className={field}>
            <option value="">{t.anyKind}</option>
            {opts.groups.map((g) => (
              <option key={g} value={g}>
                {t.groups[g] ?? g}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.from}</span>
          <DateInput name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.to}</span>
          <DateInput name="to" defaultValue={sp.to ?? ""} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="h-10 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
            {t.filter}
          </button>
          <Link href="/admin/activity" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100">
            {t.clear}
          </Link>
        </div>
      </form>

      <p className="mb-2 text-sm text-slate-600" aria-live="polite">
        {fmt(t.count, { n: list.total })}
      </p>
      {list.rows.length === 0 ? (
        <EmptyState icon={<History className="size-10" />} title={t.none} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t.colTime}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t.colWho}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t.colWhat}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t.colOn}</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">{t.colIp}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((r) => {
                const caseId = r.entityType === "case" && r.entityId ? r.entityId : typeof r.details?.caseId === "string" ? (r.details.caseId as string) : null;
                const more = summary(r.details);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-700">{formatDateTime(r.at, locale)}</td>
                    <td className="px-4 py-2.5">
                      {r.actorName ? (
                        <>
                          <span className="font-medium text-slate-900">{r.actorName}</span>
                          <span className="block text-xs text-slate-600" dir="ltr">
                            {r.actorEmail}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-600">{t.system}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-slate-900">{label(r.action)}</span>
                      {more && <span className="bidi-auto block text-xs text-slate-600">{more}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {caseId ? (
                        <Link href={`/admin/cases/${caseId}`} className="font-medium text-brand-700 hover:underline">
                          {t.openCase}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-600">{t.groups[r.entityType] ?? r.entityType}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600" dir="ltr">
                      {r.ip ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager d={d} page={list.page} pages={list.pages} basePath="/admin/activity" params={params} />
    </>
  );
}
