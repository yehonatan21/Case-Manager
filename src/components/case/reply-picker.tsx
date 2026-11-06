"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { api } from "@/lib/client-api";
import { Select } from "@/components/ui/form";

type Template = { id: string; title: string; bodyHe: string; bodyEn: string };

/** Inserts a saved reply in the client's language, with {client} and {number} filled in. Loads on first use. */
export function ReplyPicker({ vars, onPick, id }: { vars: { client: string; number: string; locale: string }; onPick: (text: string) => void; id?: string }) {
  const { d } = useI18n();
  const [list, setList] = useState<Template[] | null>(null);
  const load = async () => {
    if (list) return;
    try {
      setList(await api<Template[]>("/api/reply-templates"));
    } catch {
      setList([]);
    }
  };
  return (
    <Select
      id={id}
      aria-label={d.replies.insert}
      className="h-8 w-auto max-w-56 text-xs"
      value=""
      onFocus={load}
      onPointerDown={load}
      onChange={(e) => {
        const t = list?.find((x) => x.id === e.target.value);
        if (!t) return;
        const body = vars.locale === "en" ? t.bodyEn || t.bodyHe : t.bodyHe || t.bodyEn;
        onPick(body.replace(/\{(client|number)\}/g, (_, k: "client" | "number") => vars[k]));
      }}
    >
      <option value="">{d.replies.insert}</option>
      {(list ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </Select>
  );
}
