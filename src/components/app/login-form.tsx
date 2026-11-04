"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, ApiClientError, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";

export function LoginForm({ next, initialEmail }: { next: string | null; initialEmail?: string }) {
  const { d } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState<string | null>(null);

  const registerHref = (addr: string) => `/register?email=${encodeURIComponent(addr)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNoAccount(null);
    try {
      // Sign-in only sends a code to an existing account; unknown emails are offered registration.
      const r = await api<{ devCode?: string }>("/api/auth/request-code", { body: { email: email.trim(), purpose: "login" } });
      setSent(true);
      setDevCode(r.devCode ?? null);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "no_account") setNoAccount(email.trim());
      else setError(errorText(err, d));
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

  // Demo shortcut: /login?as=<email> sends the code straight away.
  const autoSent = useRef(false);
  useEffect(() => {
    if (initialEmail && !autoSent.current) {
      autoSent.current = true;
      void request();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmail]);

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
      {noAccount && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4" role="status">
          <p className="font-semibold text-slate-900">{d.register.noAccountTitle}</p>
          <p dir="ltr" className="break-all text-start font-medium text-brand-800">
            {noAccount}
          </p>
          <p className="mt-1 text-sm text-slate-600">{d.register.noAccountText}</p>
          <a href={registerHref(noAccount)} className="mt-3 inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800">
            {d.register.registerWithEmail}
          </a>
        </div>
      )}
      {error && (
        <Notice tone="danger" className="mt-4">
          {error}
        </Notice>
      )}
    </div>
  );
}
