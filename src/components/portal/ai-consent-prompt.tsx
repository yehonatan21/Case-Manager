"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * For clients who were never asked about AI (accounts the team opened for them): allow it, or say no.
 * Either answer is saved, so the question isn't asked again; it can be changed on the profile.
 */
export function AiConsentPrompt() {
  const { d } = useI18n();
  const t = d.aiConsent;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);

  const answer = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    try {
      await api("/api/profile", { method: "PATCH", body: { aiConsent: yes } });
      toast("success", yes ? t.allowed : t.declined);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="ai-consent-title" className="mb-6 rounded-xl border border-brand-200 bg-brand-50/60 p-5">
      <h2 id="ai-consent-title" className="flex items-center gap-2 text-base font-semibold">
        <Sparkles className="size-5 text-brand-700" aria-hidden />
        {t.title}
      </h2>
      <p className="mt-1.5 text-sm text-slate-700">{t.text}</p>
      <p className="mt-1 text-sm text-slate-600">
        {t.more}{" "}
        <a href="/privacy" className="font-medium text-brand-700 underline">
          {t.privacyLink}
        </a>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => answer(true)} loading={busy === "yes"} disabled={!!busy}>
          {t.allow}
        </Button>
        <Button variant="outline" onClick={() => answer(false)} loading={busy === "no"} disabled={!!busy}>
          {t.notNow}
        </Button>
      </div>
    </section>
  );
}
