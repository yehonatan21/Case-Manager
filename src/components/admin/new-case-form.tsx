"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt, type Locale } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useCategories } from "@/components/app/categories";
import type { CustomerType, Urgency } from "@/lib/db/schema";

export type ClientOption = {
  id: string;
  name: string;
  email: string;
  organization: string | null;
};

const CUSTOMER_TYPES: CustomerType[] = [
  "private",
  "business",
  "company",
  "other",
];
const URGENCIES: Urgency[] = ["low", "normal", "high", "urgent"];

export function NewCaseForm({
  clients,
  initialClientId,
}: {
  clients: ClientOption[];
  initialClientId?: string;
}) {
  const { d, locale } = useI18n();
  const categories = useCategories();
  const t = d.newCase;
  const router = useRouter();
  const toast = useToast();
  const startWithExisting = clients.length > 0;
  const [mode, setMode] = useState<"existing" | "new">(
    startWithExisting ? "existing" : "new",
  );
  const [clientId, setClientId] = useState(
    initialClientId && clients.some((c) => c.id === initialClientId)
      ? initialClientId
      : "",
  );
  const [client, setClient] = useState({
    name: "",
    email: "",
    phone: "",
    customerType: "private" as CustomerType,
    organizationName: "",
    locale: locale as Locale,
  });
  const [req, setReq] = useState({
    title: "",
    description: "",
    goal: "",
    serviceCategory: "other",
    urgency: "normal" as Urgency,
    assignToMe: true,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const customer =
        mode === "existing"
          ? { id: clientId }
          : {
              ...client,
              phone: client.phone || null,
              organizationName:
                client.customerType === "private"
                  ? null
                  : client.organizationName || null,
            };
      const r = await api<{ id: string; number: string }>("/api/admin/cases", {
        body: { customer, ...req, goal: req.goal || undefined },
      });
      toast("success", fmt(t.created, { number: r.number }));
      router.push(`/admin/cases/${r.id}`);
    } catch (err) {
      toast("error", errorText(err, d));
      setBusy(false);
    }
  }

  const tabClass = (active: boolean) =>
    active
      ? "rounded-full bg-card px-3.5 py-1.5 font-medium text-slate-900 shadow-card dark:bg-slate-300"
      : "rounded-full px-3.5 py-1.5 font-medium text-slate-600 hover:text-slate-900";

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <Card>
        <CardContent className="grid gap-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t.clientSection}</h2>
            <div
              className="flex gap-0.5 rounded-full bg-slate-200/60 p-1 text-sm"
              role="group"
              aria-label={t.clientSection}
            >
              <button
                type="button"
                aria-pressed={mode === "existing"}
                className={tabClass(mode === "existing")}
                onClick={() => setMode("existing")}
                disabled={!startWithExisting}
              >
                {t.existingClient}
              </button>
              <button
                type="button"
                aria-pressed={mode === "new"}
                className={tabClass(mode === "new")}
                onClick={() => setMode("new")}
              >
                {t.newClient}
              </button>
            </div>
          </div>

          {mode === "existing" ? (
            <Field label={t.selectClient} required>
              {(p) => (
                <Select
                  {...p}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="" disabled>
                    {t.selectPlaceholder}
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.email}
                      {c.organization ? ` · ${c.organization}` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.clientName} required>
                {(p) => (
                  <Input
                    {...p}
                    value={client.name}
                    maxLength={120}
                    onChange={(e) =>
                      setClient({ ...client, name: e.target.value })
                    }
                  />
                )}
              </Field>
              <Field label={d.common.email} required hint={t.newClientHint}>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    dir="ltr"
                    value={client.email}
                    maxLength={200}
                    onChange={(e) =>
                      setClient({ ...client, email: e.target.value })
                    }
                  />
                )}
              </Field>
              <Field label={d.common.phone}>
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    dir="ltr"
                    value={client.phone}
                    maxLength={40}
                    onChange={(e) =>
                      setClient({ ...client, phone: e.target.value })
                    }
                  />
                )}
              </Field>
              <Field label={t.clientLanguage}>
                {(p) => (
                  <Select
                    {...p}
                    value={client.locale}
                    onChange={(e) =>
                      setClient({ ...client, locale: e.target.value as Locale })
                    }
                  >
                    <option value="he">{d.lang.he}</option>
                    <option value="en">{d.lang.en}</option>
                  </Select>
                )}
              </Field>
              <Field label={d.account.customerType}>
                {(p) => (
                  <Select
                    {...p}
                    value={client.customerType}
                    onChange={(e) =>
                      setClient({
                        ...client,
                        customerType: e.target.value as CustomerType,
                      })
                    }
                  >
                    {CUSTOMER_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {d.customerType[ct]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {client.customerType !== "private" && (
                <Field label={t.organizationName}>
                  {(p) => (
                    <Input
                      {...p}
                      value={client.organizationName}
                      maxLength={200}
                      onChange={(e) =>
                        setClient({
                          ...client,
                          organizationName: e.target.value,
                        })
                      }
                    />
                  )}
                </Field>
              )}
            </div>
          )}
          {!startWithExisting && (
            <p className="text-sm text-slate-500">{t.noClients}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 py-5">
          <h2 className="text-base font-semibold">{t.requestSection}</h2>
          <Field label={t.requestTitle} required>
            {(p) => (
              <Input
                {...p}
                value={req.title}
                maxLength={200}
                onChange={(e) => setReq({ ...req, title: e.target.value })}
              />
            )}
          </Field>
          <Field label={t.description} required>
            {(p) => (
              <Textarea
                {...p}
                rows={5}
                value={req.description}
                maxLength={8000}
                onChange={(e) =>
                  setReq({ ...req, description: e.target.value })
                }
              />
            )}
          </Field>
          <Field label={t.goal}>
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={req.goal}
                maxLength={2000}
                onChange={(e) => setReq({ ...req, goal: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={d.workspace.category}>
              {(p) => (
                <Select
                  {...p}
                  value={req.serviceCategory}
                  onChange={(e) =>
                    setReq({ ...req, serviceCategory: e.target.value })
                  }
                >
                  {categories.list.map((c) => (
                    <option key={c.key} value={c.key}>
                      {categories.label(c.key)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={d.workspace.urgency}>
              {(p) => (
                <Select
                  {...p}
                  value={req.urgency}
                  onChange={(e) =>
                    setReq({ ...req, urgency: e.target.value as Urgency })
                  }
                >
                  {URGENCIES.map((u) => (
                    <option key={u} value={u}>
                      {d.urgency[u]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div>
            <Checkbox
              label={t.assignToMe}
              checked={req.assignToMe}
              onChange={(e) => setReq({ ...req, assignToMe: e.target.checked })}
            />
            <p className="ms-6 mt-1 text-xs text-slate-500">
              {t.assignToMeHint}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          type="submit"
          loading={busy}
          disabled={mode === "existing" && !clientId}
        >
          {t.create}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {d.common.cancel}
        </Button>
      </div>
    </form>
  );
}
