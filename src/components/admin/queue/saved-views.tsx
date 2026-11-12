"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** The user's saved Work queue filters, and a button to save the current one. */
export function SavedViews({ views, currentQuery }: { views: { id: string; name: string; query: string }[]; currentQuery: string }) {
  const { d } = useI18n();
  const t = d.queue;
  const router = useRouter();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/me/views", { method: "POST", body: { name, query: currentQuery } });
      toast("success", t.viewSaved);
      setNaming(false);
      setName("");
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/api/me/views/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.length > 0 && (
        <ul aria-label={t.savedViews} className="flex flex-wrap gap-1.5">
          {views.map((v) => (
            <li key={v.id} className={`flex items-center rounded-full border text-xs ${v.query === currentQuery ? "border-brand-300 bg-brand-50 text-brand-900" : "border-slate-200 bg-card text-slate-700"}`}>
              <Link href={`/admin/queue?${v.query}`} className="flex items-center gap-1 py-1 ps-2.5 pe-1 font-medium hover:underline" aria-current={v.query === currentQuery ? "page" : undefined}>
                <Bookmark className="size-3" aria-hidden />
                <span className="bidi-auto">{v.name}</span>
              </Link>
              <button type="button" onClick={() => remove(v.id)} className="grid size-6 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={fmt(t.deleteView, { name: v.name })}>
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {naming ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <Input autoFocus aria-label={t.saveViewName} placeholder={t.saveViewName} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-8 w-48 text-sm" />
          <Button size="sm" type="submit" loading={busy} disabled={!name.trim()}>
            {d.common.save}
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(false)}>
            {d.common.cancel}
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setNaming(true)}>
          <Bookmark className="size-3.5" aria-hidden />
          {t.saveView}
        </Button>
      )}
    </div>
  );
}
