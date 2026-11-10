import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { requireStaffPage } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listTasksForStaff, TASK_PRIORITIES } from "@/lib/services/tasks";
import { listAssignableStaff } from "@/lib/services/users";
import { taskStatusEnum } from "@/lib/db/schema";
import { FilterBar, type FilterField } from "@/components/ui/filter-bar";
import { Pager } from "@/components/ui/pager";
import { CardList, RecordCard, TableFrame } from "@/components/ui/record-card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TaskStatusBadge } from "@/components/app/status";
import { cn } from "@/lib/utils";
import { officeToday } from "@/lib/services/queue";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.tasksTitle };
}

type Search = { scope?: string; overdue?: string; q?: string; assignee?: string; priority?: string; status?: string; from?: string; to?: string; page?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaffPage("/admin/tasks", "tasks");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const t = d.filterBar;
  const db = await getDb();
  const mine = sp.scope !== "all";
  const overdueTab = sp.overdue === "1";
  const [list, staff] = await Promise.all([
    listTasksForStaff(db, user, { mine, overdue: overdueTab, q: sp.q, assignee: sp.assignee, priority: sp.priority, status: sp.status, from: sp.from, to: sp.to, page: Number(sp.page) || 1 }),
    mine ? Promise.resolve([]) : listAssignableStaff(db),
  ]);
  const rows = list.rows;
  const today = officeToday();
  // The tab the list is on stays when filtering or clearing; the filters that don't apply to it aren't shown.
  const keep = { scope: sp.scope === "all" ? "all" : undefined, overdue: overdueTab ? "1" : undefined };
  const values = { q: sp.q, assignee: mine ? undefined : sp.assignee, priority: sp.priority, status: overdueTab ? undefined : sp.status, from: sp.from, to: sp.to };
  const filtered = Object.values(values).some(Boolean);
  const fields: FilterField[] = [
    { type: "search", name: "q", label: t.search, placeholder: t.tasksSearch },
    ...(mine
      ? []
      : [{ type: "select" as const, name: "assignee", label: t.assignee, options: [{ value: "none", label: t.noAssignee }, ...staff.map((s) => ({ value: s.id, label: s.name }))] }]),
    { type: "select", name: "priority", label: t.priority, options: TASK_PRIORITIES.map((p) => ({ value: p, label: d.priority[p] })) },
    ...(overdueTab
      ? []
      : [
          {
            type: "select" as const,
            name: "status",
            label: t.status,
            any: false as const,
            options: [{ value: "open", label: t.openTasks }, ...taskStatusEnum.enumValues.map((s) => ({ value: s, label: d.taskStatus[s] })), { value: "all", label: t.allStatuses }],
          },
        ]),
    { type: "date", name: "from", label: t.dueFrom, range: "from" },
    { type: "date", name: "to", label: t.dueTo, range: "to" },
  ];
  const tabs = [
    { href: "/admin/tasks", label: d.admin.myTasks, active: mine && sp.overdue !== "1" },
    { href: "/admin/tasks?scope=all", label: d.admin.allTasks, active: !mine && sp.overdue !== "1" },
    { href: "/admin/tasks?scope=all&overdue=1", label: d.tasks.overdue, active: sp.overdue === "1" },
  ];
  return (
    <>
      <PageHeader title={d.admin.tasksTitle} />
      <nav aria-label={d.nav.filterMenu} className="mb-4 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", t.active ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <FilterBar d={d} basePath="/admin/tasks" values={values} keep={keep} total={list.total} fields={fields} />
      {rows.length === 0 ? (
        <EmptyState title={filtered ? t.noMatch : d.admin.tasksEmpty} />
      ) : (
        <>
        <TableFrame>
          <table className="w-full min-w-[50rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.task}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.case}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.assignee}</th>
                <th className="px-4 py-3 text-start font-medium">{t.priority}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.due}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const open = r.task.status !== "done" && r.task.status !== "cancelled";
                const overdue = open && r.task.dueDate && r.task.dueDate < today;
                return (
                  <tr key={r.task.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/cases/${r.task.caseId}?tab=tasks`} className="bidi-auto font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {r.task.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="font-mono text-xs" dir="ltr">{r.caseNumber}</span> · <span className="bidi-auto">{r.caseTitle}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.assigneeName ?? d.common.unassigned}</td>
                    <td className={cn("px-4 py-3", r.task.priority === "high" ? "font-medium text-slate-900" : "text-slate-600")}>{d.priority[r.task.priority]}</td>
                    <td className={cn("px-4 py-3", overdue ? "font-semibold text-red-600" : "text-slate-600")}>{r.task.dueDate ? formatDate(r.task.dueDate, locale) : "—"}</td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={r.task.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
        <CardList>
          {rows.map((r) => {
            const open = r.task.status !== "done" && r.task.status !== "cancelled";
            const overdue = open && r.task.dueDate && r.task.dueDate < today;
            return (
              <RecordCard
                key={r.task.id}
                href={`/admin/cases/${r.task.caseId}?tab=tasks`}
                eyebrow={
                  <>
                    <span className="font-mono" dir="ltr">
                      {r.caseNumber}
                    </span>{" "}
                    · <span className="bidi-auto">{r.caseTitle}</span>
                  </>
                }
                title={r.task.title}
                status={<TaskStatusBadge status={r.task.status} />}
                details={[
                  { label: d.admin.col.due, value: <span className={overdue ? "font-semibold text-red-700" : undefined}>{r.task.dueDate ? formatDate(r.task.dueDate, locale) : "—"}</span> },
                  { label: t.priority, value: d.priority[r.task.priority] },
                  { label: d.admin.col.assignee, value: r.assigneeName ?? d.common.unassigned, wide: true },
                ]}
              />
            );
          })}
        </CardList>
        </>
      )}
      <Pager d={d} page={list.page} pages={list.pages} basePath="/admin/tasks" params={{ ...keep, ...values }} />
    </>
  );
}
