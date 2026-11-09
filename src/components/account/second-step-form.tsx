"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** Sign-in, step two: the 6-digit code from the authenticator app, or a recovery code. */
export function SecondStepForm({ next }: { next: string }) {
  const { d } = useI18n();
  const t = d.twoFactor;
  const router = useRouter();
  const toast = useToast();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = recovery ? /^[a-z0-9]{4}-?[a-z0-9]{4}-?[a-z0-9]{4}$/i.test(code.trim()) : /^\d{6}$/.test(code.replace(/\s/g, ""));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const r = await api<{ recoveryLeft: number | null }>("/api/auth/2fa", { body: { code: recovery ? code.trim() : code.replace(/\s/g, "") } });
      if (r.recoveryLeft !== null) toast("success", fmt(t.recoveryUsed, { n: r.recoveryLeft }));
      router.push(next);
      router.refresh();
    } catch (err) {
      toast("error", errorText(err, d));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {recovery ? (
        <Field label={t.recoveryCode} hint={t.recoveryHint} required>
          {(p) => <Input {...p} dir="ltr" autoComplete="off" autoFocus spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
      ) : (
        <Field label={t.code} required>
          {(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} className="text-center text-lg tracking-[0.3em]" />}
        </Field>
      )}
      <Button type="submit" className="w-full" loading={busy} disabled={!valid}>
        {t.verify}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline"
          onClick={() => {
            setRecovery(!recovery);
            setCode("");
          }}
        >
          {recovery ? t.useApp : t.useRecovery}
        </button>
        <button
          type="button"
          className="text-slate-600 hover:underline"
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" }).catch(() => {});
            router.push("/login");
          }}
        >
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
