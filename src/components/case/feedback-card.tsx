"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-4", n <= value ? "fill-amber-400 text-amber-500" : "text-slate-300")} />
      ))}
    </span>
  );
}

/** Client: rate a completed case. Five radio buttons (keyboard: arrows), each with a text label. */
export function FeedbackCard({ caseId, existing }: { caseId: string; existing: { rating: number; comment: string | null } | null }) {
  const { d } = useI18n();
  const t = d.feedback;
  const router = useRouter();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/cases/${caseId}/feedback`, { body: { rating, comment: comment || null } });
      toast("success", t.thanks);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="feedback" className="scroll-mt-20">
      <CardContent className="grid gap-3 py-5">
        <h2 className="text-base font-semibold">{t.title}</h2>
        {existing ? (
          <div>
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <Stars value={existing.rating} /> {fmt(t.yours, { n: existing.rating })}
            </p>
            {existing.comment && <p className="bidi-auto mt-1 text-sm text-slate-600">{existing.comment}</p>}
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-600">{t.hint}</p>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-800">{t.rating}</legend>
              <div className="flex flex-wrap items-center gap-1" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer rounded p-0.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600" onMouseEnter={() => setHover(n)}>
                    <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
                    <Star aria-hidden className={cn("size-8 transition-colors", n <= (hover || rating) ? "fill-amber-400 text-amber-500" : "text-slate-300")} />
                    <span className="sr-only">
                      {fmt(t.stars, { n })} — {t.labels[n - 1]}
                    </span>
                  </label>
                ))}
                {(hover || rating) > 0 && <span className="ms-2 text-sm font-medium text-slate-700">{t.labels[(hover || rating) - 1]}</span>}
              </div>
            </fieldset>
            <Field label={t.comment}>{(p) => <Textarea {...p} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
            <div>
              <Button onClick={submit} loading={busy} disabled={rating === 0}>
                {t.submit}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
