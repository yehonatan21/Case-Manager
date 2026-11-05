"use client";

import { useId, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, ApiClientError, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import type { CustomerType } from "@/lib/db/schema";
import { GoogleButton } from "@/components/app/google-button";

/**
 * Contact details + passwordless verification. Used at the end of a request ("request"), on the
 * standalone register page ("register"), and to finish a first Google sign-in ("google": email is
 * already verified by Google, so no code step).
 */
export function AccountStep({
  onBack,
  onVerified,
  submitting,
  mode = "request",
  google,
  googleNext,
  googleProfile,
  initialEmail,
}: {
  onBack?: () => void;
  onVerified: () => Promise<void>;
  submitting: boolean;
  mode?: "request" | "register" | "google";
  google?: boolean;
  googleNext?: string;
  googleProfile?: { email: string; name: string };
  /** Prefilled address, e.g. when sign-in found no account for it. */
  initialEmail?: string;
}) {
  const { d } = useI18n();
  const [name, setName] = useState(googleProfile?.name ?? "");
  const [email, setEmail] = useState(googleProfile?.email ?? initialEmail ?? "");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<CustomerType>("private");
  const [orgName, setOrgName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [terms, setTerms] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const isOrg = type === "business" || type === "company";
  const termsErrorId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a failed check, move focus to the first field with an error so it is announced (WCAG 3.3.1). */
  const focusFirstError = () => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

  const completeGoogle = async () => {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = d.account.nameRequired;
    if (!terms) fe.terms = d.account.termsRequired;
    setFieldErr(fe);
    if (Object.keys(fe).length) return focusFirstError();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/google/complete", {
        body: {
          name: name.trim(),
          phone: phone.trim() || null,
          customerType: type,
          organizationName: isOrg ? orgName.trim() || null : null,
          organizationNumber: isOrg ? orgId.trim() || null : null,
          acceptTerms: terms,
          aiConsent,
        },
      });
      await onVerified();
    } catch (e) {
      setError(errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = d.account.nameRequired;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = d.account.emailInvalid;
    if (!terms) fe.terms = d.account.termsRequired;
    setFieldErr(fe);
    if (Object.keys(fe).length) return focusFirstError();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/api/auth/request-code", { body: { email: email.trim() } });
      setCodeSent(true);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      setError(errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/verify", {
        body: {
          email: email.trim(),
          code: code.trim(),
          signup: {
            name: name.trim(),
            phone: phone.trim() || null,
            customerType: type,
            organizationName: isOrg ? orgName.trim() || null : null,
            organizationNumber: isOrg ? orgId.trim() || null : null,
            acceptTerms: terms,
            aiConsent,
          },
        },
      });
      await onVerified();
    } catch (e) {
      setError(e instanceof ApiClientError && e.code === "validation" ? d.errors.invalid_code : errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  const termsLabel = (() => {
    const parts = d.account.acceptTerms.split(/(\{terms\}|\{privacy\})/);
    return parts.map((p, i) =>
      p === "{terms}" ? (
        <a key={i} href="/terms" target="_blank" className="font-medium text-brand-700 underline">
          {d.account.termsLink}
        </a>
      ) : p === "{privacy}" ? (
        <a key={i} href="/privacy" target="_blank" className="font-medium text-brand-700 underline">
          {d.account.privacyLink}
        </a>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  })();

  return (
    <div ref={rootRef}>
    <Card className="mt-6 border-brand-200">
      <CardHeader className="flex-col items-stretch">
        <CardTitle>{mode === "request" ? d.account.title : mode === "google" ? d.register.googleTitle : d.register.title}</CardTitle>
        <p className="text-sm text-slate-600">{mode === "request" ? d.account.subtitle : mode === "google" ? d.register.googleSubtitle : d.register.subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-5 py-5">
        {google && mode !== "google" && !codeSent && (
          <div>
            <GoogleButton next={googleNext} />
            <div className="mt-5 flex items-center gap-3 text-xs text-slate-500">
              <span className="h-px flex-1 bg-slate-200" />
              {d.register.orEmail}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        )}
        <fieldset disabled={codeSent} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={d.account.fullName} required error={fieldErr.name}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
            </Field>
            <Field label={d.account.email} required error={fieldErr.email}>
              {(p) => <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" readOnly={mode === "google"} />}
            </Field>
            <Field label={d.account.phone} hint={d.account.phoneHint}>
              {(p) => <Input {...p} type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">{d.account.customerType}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["private", "business", "company", "other"] as const).map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                    <input type="radio" name="ctype" value={t} checked={type === t} onChange={() => setType(t)} className="accent-brand-700" />
                    {d.customerType[t]}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {isOrg && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={d.account.orgName}>{(p) => <Input {...p} value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />}</Field>
              <Field label={d.account.orgId}>{(p) => <Input {...p} dir="ltr" value={orgId} onChange={(e) => setOrgId(e.target.value)} />}</Field>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Bot className="size-4 text-brand-700" aria-hidden />
              {d.account.aiTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{d.account.aiText}</p>
            <Checkbox className="mt-3" label={d.account.aiConsent} checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
          </div>

          <div>
            <Checkbox
              label={termsLabel}
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              aria-invalid={fieldErr.terms ? true : undefined}
              aria-describedby={fieldErr.terms ? termsErrorId : undefined}
            />
            {fieldErr.terms && (
              <p id={termsErrorId} role="alert" className="mt-1 text-xs text-red-600">
                {fieldErr.terms}
              </p>
            )}
          </div>
        </fieldset>

        {codeSent && (
          <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-4">
            <p className="text-sm text-slate-700">{fmt(d.account.codeSentTo, { email })}</p>
            {devCode && <p className="mt-1 text-xs font-medium text-amber-800">{fmt(d.account.devCode, { code: devCode })}</p>}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label={d.account.code} className="w-40">
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
              <Button size="lg" onClick={verify} loading={busy || submitting} disabled={code.length !== 6}>
                {busy ? d.account.verifying : mode === "request" ? d.account.verifyAndSubmit : d.register.verifyAndCreate}
              </Button>
            </div>
            <div className="mt-3 flex gap-4 text-sm">
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={sendCode} disabled={busy}>
                {d.account.resend}
              </button>
              <button type="button" className="text-slate-600 hover:underline" onClick={() => setCodeSent(false)}>
                {d.account.changeEmail}
              </button>
            </div>
          </div>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        {!codeSent && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onBack ? (
              <Button variant="ghost" onClick={onBack}>
                {d.common.back}
              </Button>
            ) : (
              <span />
            )}
            {mode === "google" ? (
              <Button size="lg" onClick={completeGoogle} loading={busy || submitting}>
                {d.register.createAccount}
              </Button>
            ) : (
              <Button size="lg" onClick={sendCode} loading={busy}>
                {busy ? d.account.sendingCode : d.account.sendCode}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
