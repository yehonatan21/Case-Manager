"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { CustomerType } from "@/lib/db/schema";

export function ProfileForm({
  user,
  customerType,
  organization,
  whatsappAvailable = false,
}: {
  user: { name: string; email: string; phone: string | null; locale: "he" | "en"; emailNotifications: boolean; whatsapp: boolean; aiConsent?: boolean | null };
  customerType: CustomerType | null;
  organization: string | null;
  /** WhatsApp is connected, so users can opt in to updates there. */
  whatsappAvailable?: boolean;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [locale, setLocale] = useState(user.locale);
  const [emailNotifications, setEmailNotifications] = useState(user.emailNotifications);
  const [whatsapp, setWhatsapp] = useState(user.whatsapp);
  const [aiConsent, setAiConsent] = useState(!!user.aiConsent);
  // Only clients are asked (staff accounts don't get the setting).
  const showAi = user.aiConsent !== null && user.aiConsent !== undefined;
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/profile", { method: "PATCH", body: { name, phone: phone || null, locale, emailNotifications, ...(whatsappAvailable ? { whatsapp } : {}), ...(showAi && aiConsent !== !!user.aiConsent ? { aiConsent } : {}) } });
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
      toast("success", d.portal.profileSaved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5 py-6">
        <Field label={d.account.fullName}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={d.account.email}>{(p) => <Input {...p} value={user.email} dir="ltr" disabled />}</Field>
        <Field label={d.account.phone}>{(p) => <Input {...p} type="tel" dir="ltr" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        {customerType && (
          <p className="text-sm text-slate-600">
            {d.account.customerType}: <span className="font-medium text-slate-800">{d.customerType[customerType]}</span>
            {organization && <> · {organization}</>}
          </p>
        )}
        <Field label={d.portal.preferredLanguage}>
          {(p) => (
            <Select {...p} value={locale} onChange={(e) => setLocale(e.target.value as "he" | "en")}>
              <option value="he">{d.lang.he}</option>
              <option value="en">{d.lang.en}</option>
            </Select>
          )}
        </Field>
        <Checkbox label={d.portal.emailNotifications} checked={emailNotifications} onChange={(e) => setEmailNotifications(e.target.checked)} />
        {showAi && (
          <div>
            <Checkbox label={d.portal.aiConsentProfile} checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} aria-describedby="ai-consent-hint" />
            <p id="ai-consent-hint" className="ms-6 mt-1 text-xs text-slate-500">
              {d.portal.aiConsentProfileHint}
            </p>
          </div>
        )}
        {whatsappAvailable && (
          <div>
            <Checkbox label={d.portal.whatsappUpdates} checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} aria-describedby="whatsapp-hint" />
            <p id="whatsapp-hint" className="ms-6 mt-1 text-xs text-slate-500">
              {whatsapp && !phone.trim() ? d.portal.whatsappNeedsPhone : d.portal.whatsappHint}
            </p>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>
            {d.common.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
