import Link from "next/link";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { CONVERSATION_FILTERS, conversationCounts, listConversations, listReplyTemplates } from "@/lib/services/conversations";
import { PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { ConversationList } from "@/components/admin/conversations/conversation-list";
import { ReplyTemplates } from "@/components/admin/conversations/reply-templates";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.conversations.title };
}

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; page?: string }> }) {
  const user = await requirePageStaff("/admin/conversations");
  if (user.role === "finance") redirect("/admin");
  const sp = await searchParams;
  const { d } = await getDict();
  const t = d.conversations;
  const db = await getDb();
  const manager = user.role === "admin" || user.role === "case_manager";
  const showReplies = sp.filter === "replies";
  const [counts, templates] = await Promise.all([conversationCounts(db, user), listReplyTemplates(db)]);
  const filters = CONVERSATION_FILTERS.filter((f) => manager || f !== "unassigned");
  const active = showReplies ? "replies" : (CONVERSATION_FILTERS as readonly string[]).includes(sp.filter ?? "") ? sp.filter! : "needs_reply";
  const list = showReplies ? null : await listConversations(db, user, { filter: active, q: sp.q, page: Number(sp.page) || 1 });
  const href = (f: string) => (f === "needs_reply" ? "/admin/conversations" : `/admin/conversations?filter=${f}`);

  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <nav aria-label={t.filtersLabel} className="mb-4 flex flex-wrap gap-1">
        {[...filters, "replies" as const].map((f) => (
          <Link
            key={f}
            href={href(f)}
            aria-current={active === f ? "page" : undefined}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", active === f ? "bg-brand-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}
          >
            {f === "replies" ? d.replies.tab : t.filters[f]}
            {f !== "replies" && <span className={cn("rounded-full px-1.5 text-[11px] font-bold tabular-nums", active === f ? "bg-white/20" : "bg-slate-100 text-slate-700")}>{counts[f]}</span>}
          </Link>
        ))}
      </nav>
      {showReplies ? (
        <ReplyTemplates templates={templates.map((x) => ({ id: x.id, title: x.title, bodyHe: x.bodyHe, bodyEn: x.bodyEn }))} canEdit={manager} />
      ) : (
        <>
          <form className="mb-3 flex flex-wrap items-end gap-2" role="search">
            {active !== "needs_reply" && <input type="hidden" name="filter" value={active} />}
            <div className="min-w-56 flex-1">
              <label htmlFor="conv-q" className="sr-only">
                {d.common.search}
              </label>
              <Input id="conv-q" name="q" type="search" defaultValue={sp.q} placeholder={d.common.searchPlaceholder} />
            </div>
            <Button type="submit" variant="outline">
              {d.common.search}
            </Button>
          </form>
          <ConversationList rows={list!.rows} />
          <Pager d={d} page={list!.page} hasNext={list!.hasNext} basePath="/admin/conversations" params={{ filter: active === "needs_reply" ? undefined : active, q: sp.q }} />
        </>
      )}
    </>
  );
}
