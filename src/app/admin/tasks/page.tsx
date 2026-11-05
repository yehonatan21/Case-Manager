import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listTasksForStaff } from "@/lib/services/tasks";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TaskStatusBadge } from "@/components/app/status";
import { todayIso, cn } from "@/lib/utils";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.admin.tasksTitle };
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; overdue?: string }> }) {
  const user = await requirePageStaff("/admin/tasks");
  if (user.role === "finance") redirect("/admin");
  const sp = await searchParams;
  const { d, locale } = await getDict();
  const mine = sp.scope !== "all";
  const rows = await listTasksForStaff(await getDb(), user, { mine, overdue: sp.overdue === "1" });
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
      {rows.length === 0 ? (
        <EmptyState title={d.admin.tasksEmpty} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.task}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.case}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.assignee}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.due}</th>
                <th className="px-4 py-3 text-start font-medium">{d.admin.col.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const overdue = r.task.dueDate && r.task.dueDate < todayIso();
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
                    <td className={cn("px-4 py-3", overdue ? "font-semibold text-red-600" : "text-slate-600")}>{r.task.dueDate ? formatDate(r.task.dueDate, locale) : "—"}</td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={r.task.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
