"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export function StartRequest() {
  const { d } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const start = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api<{ id: string }>("/api/intake", { body: { message, mode: "chat" } });
      router.push(`/intake/${s.id}`);
    } catch (e) {
      setError(errorText(e, d));
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start(text);
        }}
        className="rounded-card bg-card shadow-card p-2 shadow-lg shadow-brand-900/5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500"
      >
        <label htmlFor="start-text" className="sr-only">
          {d.home.title}
        </label>
        <textarea
          id="start-text"
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start(text);
          }}
          rows={4}
          maxLength={4000}
          placeholder={d.home.placeholder}
          className="bidi-auto w-full resize-none rounded-xl border-0 bg-transparent px-3 py-3 text-base leading-relaxed text-slate-900 placeholder:text-slate-500 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Sparkles className="size-3.5" aria-hidden />
            {d.common.poweredByAi}
          </span>
          <Button type="submit" size="lg" loading={busy} disabled={!text.trim()}>
            {busy ? d.home.starting : d.home.start}
            {!busy && <ArrowRight className="size-4 flip-rtl" aria-hidden />}
          </Button>
        </div>
      </form>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <div className="mt-5">
        <p className="mb-2 text-sm text-slate-500">{d.home.examplesLabel}</p>
        <div className="flex flex-wrap gap-2">
          {d.home.examples.map((ex, i) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => {
                if (i === d.home.examples.length - 1) {
                  setText("");
                  ref.current?.focus();
                } else void start(ex);
              }}
              className="rounded-full border border-slate-200 bg-card px-3.5 py-1.5 text-sm text-slate-700 shadow-xs transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-60"
            >
              {ex}
            </button>
          ))}
        </div>
        <a href="/intake/manual" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          {d.home.manualLink}
        </a>
      </div>
    </div>
  );
}
