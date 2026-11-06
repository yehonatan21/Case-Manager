import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listStaff } from "@/lib/services/users";
import { listServiceCategories } from "@/lib/services/categories";
import { QUEUE_VIEWS, cleanViewQuery, listQueue, listSavedViews, queueCounts, teamWorkload, type QueueView } from "@/lib/services/queue";
import { PageHeader } from "@/components/ui/misc";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { QueueTable } from "@/components/admin/queue/queue-table";
import { SavedViews } from "@/components/admin/queue/saved-views";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.queue.title };
}

type SP = { view?: string; q?: string; category?: string; assignee?: string; urgency?: string; page?: string };

export default async function QueuePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageStaff("/admin/queue");
  if (user.role === "finance") redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.queue;
  const db = await getDb();
  const manager = user.role === "admin" || user.role === "case_manager";
  const team = sp.view === "team" && manager;
  // Staff only see cases handed to them, so "unassigned" would always be empty for them.
  const views = QUEUE_VIEWS.filter((v) => manager || v !== "unassigned");
  const [counts, saved, staff, categories] = await Promise.all([
    queueCounts(db, user),
    listSavedViews(db, user),
    manager ? listStaff(db) : Promise.resolve([]),
    listServiceCategories(db),
  ]);
  const assignable = staff.filter((s) => s.role !== "finance").map((s) => ({ id: s.id, name: s.name }));
  const currentQuery = cleanViewQuery(new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]).toString());
  const tab = (v: QueueView | "team") => {
    const sp2 = new URLSearchParams();
    if (v !== "mine") sp2.set("view", v);
    const qs = sp2.toString();
    return qs ? `/admin/queue?${qs}` : "/admin/queue";
  };
  const active: QueueView | "team" = team ? "team" : ((QUEUE_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as QueueView) : "mine");

  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <nav aria-label={t.viewsLabel} className="mb-4 -mx-1 flex flex-wrap gap-1">
        {[...views, ...(manager ? (["team"] as const) : [])].map((v) => (
          <Link
            key={v}
            href={tab(v)}
            aria-current={active === v ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium",
              active === v ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
              v === "overdue" && active !== v && counts.overdue > 0 && "text-red-700 ring-red-200",
            )}
          >
            {t.views[v]}
            {v !== "team" && (
              <span className={cn("rounded-full px-1.5 text-[11px] font-bold tabular-nums", active === v ? "bg-white/20" : "bg-slate-100 text-slate-700")}>{counts[v]}</span>
            )}
          </Link>
        ))}
      </nav>
      {team ? (
        <TeamWorkload d={d} data={await teamWorkload(db, user)} />
      ) : (
        <>
          <form className="mb-3 flex flex-wrap items-end gap-2" role="search" aria-label={t.filters}>
            {active !== "mine" && <input type="hidden" name="view" value={active} />}
            <div className="min-w-56 flex-1">
              <label htmlFor="queue-q" className="sr-only">
                {d.common.search}
              </label>
              <Input id="queue-q" name="q" type="search" defaultValue={sp.q} placeholder={d.common.searchPlaceholder} />
            </div>
            <Select name="category" defaultValue={sp.category ?? ""} aria-label={d.admin.col.category} className="w-auto">
              <option value="">{t.anyCategory}</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {locale === "he" ? c.he : c.en}
                </option>
              ))}
            </Select>
            {manager && (
              <Select name="assignee" defaultValue={sp.assignee ?? ""} aria-label={t.col.assignee} className="w-auto">
                <option value="">{t.anyAssignee}</option>
                <option value="unassigned">{d.common.unassigned}</option>
                {assignable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
            <Select name="urgency" defaultValue={sp.urgency ?? ""} aria-label={t.col.urgency} className="w-auto">
              <option value="">{t.anyUrgency}</option>
              {(["urgent", "high", "normal", "low"] as const).map((u) => (
                <option key={u} value={u}>
                  {d.urgency[u]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline">
              {d.common.filter}
            </Button>
          </form>
          <div className="mb-3">
            <SavedViews views={saved.map((v) => ({ id: v.id, name: v.name, query: v.query }))} currentQuery={currentQuery} />
          </div>
          <QueueList user={user} sp={sp} manager={manager} staff={assignable} />
        </>
      )}
    </>
  );
}

async function QueueList({ user, sp, manager, staff }: { user: Awaited<ReturnType<typeof requirePageStaff>>; sp: SP; manager: boolean; staff: { id: string; name: string }[] }) {
  const { d } = await getDict();
  const list = await listQueue(await getDb(), user, { ...sp, page: Number(sp.page) || 1 });
  return (
    <>
      <QueueTable
        rows={list.rows.map((r) => ({ ...r, lastActivityAt: new Date(r.lastActivityAt).toISOString() }))}
        today={list.today}
        canBulk={manager}
        staff={staff}
      />
      <Pager d={d} page={list.page} hasNext={list.hasNext} basePath="/admin/queue" params={{ view: sp.view, q: sp.q, category: sp.category, assignee: sp.assignee, urgency: sp.urgency }} />
    </>
  );
}

function TeamWorkload({ d, data }: { d: Awaited<ReturnType<typeof getDict>>["d"]; data: Awaited<ReturnType<typeof teamWorkload>> }) {
  const t = d.queue.team;
  const cell = (n: number, alert = false) => <td className={cn("px-3 py-3 text-center tabular-nums", alert && n > 0 ? "font-semibold text-red-700" : "text-slate-700")}>{n}</td>;
  return (
    <section aria-labelledby="team-title">
      <h2 id="team-title" className="text-lg font-semibold">
        {t.title}
      </h2>
      <p className="mb-3 text-sm text-slate-500">{t.subtitle}</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-3 text-start font-medium">{t.member}</th>
              <th className="px-3 py-3 font-medium">{t.openCases}</th>
              <th className="px-3 py-3 font-medium">{t.urgent}</th>
              <th className="px-3 py-3 font-medium">{t.late}</th>
              <th className="px-3 py-3 font-medium">{t.dueSoon}</th>
              <th className="px-3 py-3 font-medium">{t.waitingClient}</th>
              <th className="px-3 py-3 font-medium">{t.openTasks}</th>
              <th className="px-3 py-3 font-medium">{t.lateTasks}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.members.map((m) => (
              <tr key={m.id}>
                <th scope="row" className="px-3 py-3 text-start font-medium">
                  <Link href={`/admin/queue?view=all&assignee=${m.id}`} className="bidi-auto text-slate-900 hover:text-brand-700 hover:underline">
                    {m.name}
                  </Link>
                  <span className="block text-xs font-normal text-slate-500">{d.roles[m.role as "staff"]}</span>
                </th>
                {cell(m.cases.open)}
                {cell(m.cases.urgent)}
                {cell(m.cases.overdue, true)}
                {cell(m.cases.dueSoon)}
                {cell(m.cases.waitingClient)}
                {cell(m.tasks.open)}
                {cell(m.tasks.overdue, true)}
              </tr>
            ))}
            <tr className="bg-slate-50">
              <th scope="row" className="px-3 py-3 text-start font-medium">
                <Link href="/admin/queue?view=unassigned" className="text-slate-900 hover:text-brand-700 hover:underline">
                  {t.unassigned}
                </Link>
              </th>
              {cell(data.unassigned.open)}
              {cell(data.unassigned.urgent)}
              {cell(data.unassigned.overdue, true)}
              <td colSpan={4} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
