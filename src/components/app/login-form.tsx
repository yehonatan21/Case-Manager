"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, ApiClientError, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

export function LoginForm({ next }: { next: string | null }) {
  const { d } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/api/auth/request-code", { body: { email: email.trim() } });
      setSent(true);
      setDevCode(r.devCode ?? null);
    } catch (err) {
      setError(errorText(err, d));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ home: string }>("/api/auth/verify", { body: { email: email.trim(), code } });
      router.push(next ?? r.home);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === "signup_required" ? d.login.noAccount : errorText(err, d));
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      {!sent ? (
        <form onSubmit={request} className="space-y-4">
          <Field label={d.account.email} required>
            {(p) => <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={!email.includes("@")}>
            {d.login.sendCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-slate-600">{fmt(d.account.codeSentTo, { email })}</p>
          {devCode && <p className="text-xs font-medium text-amber-800">{fmt(d.account.devCode, { code: devCode })}</p>}
          <Field label={d.account.code} required>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center text-lg tracking-[0.4em]"
                autoFocus
              />
            )}
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy} disabled={code.length !== 6}>
            {d.login.verify}
          </Button>
          <div className="flex justify-between text-sm">
            <button type="button" onClick={() => request()} className="font-medium text-brand-700 hover:underline">
              {d.account.resend}
            </button>
            <button type="button" onClick={() => setSent(false)} className="text-slate-600 hover:underline">
              {d.account.changeEmail}
            </button>
          </div>
        </form>
      )}
      {error && (
        <Notice tone="danger" className="mt-4">
          {error}
        </Notice>
      )}
    </div>
  );
}
