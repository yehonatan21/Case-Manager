"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { OrgAccess, OrgRole } from "@/lib/db/schema";

type Company = { id: string; name: string; businessId: string | null; members: { customerId: string; name: string; email: string; phone: string | null; role: OrgRole; access: OrgAccess }[] };
const ROLES: OrgRole[] = ["owner", "contact", "billing", "signatory"];
const ACCESS: OrgAccess[] = ["all", "own"];

/** Staff: the client's company and its contacts (roles and what each sees). */
export function CompanyCard({ customerId, company, canEdit }: { customerId: string; company: Company | null; canEdit: boolean }) {
  const { d } = useI18n();
  const t = d.company;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [org, setOrg] = useState({ name: company?.name ?? "", businessId: company?.businessId ?? "" });
  const [adding, setAdding] = useState(false);
  const [c, setC] = useState({ name: "", email: "", phone: "", role: "contact" as OrgRole, access: "all" as OrgAccess });

  const call = async (key: string, fn: () => Promise<unknown>, done?: () => void, msg?: string) => {
    setBusy(key);
    try {
      await fn();
      done?.();
      toast("success", msg ?? d.common.saved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Building2 className="size-4 text-slate-500" aria-hidden /> {t.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!company && <p className="text-slate-600">{t.notCompany}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t.name} className="min-w-48 flex-1">{(p) => <Input {...p} value={org.name} maxLength={200} onChange={(e) => setOrg({ ...org, name: e.target.value })} />}</Field>
            <Field label={t.businessId} className="w-44">{(p) => <Input {...p} dir="ltr" value={org.businessId} maxLength={40} onChange={(e) => setOrg({ ...org, businessId: e.target.value })} />}</Field>
            <Button variant={company ? "outline" : "primary"} loading={busy === "org"} disabled={!org.name.trim()} onClick={() => call("org", () => api(`/api/admin/customers/${customerId}/company`, { method: "PUT", body: { name: org.name, businessId: org.businessId || null } }))}>
              {company ? t.saveCompany : t.makeCompany}
            </Button>
          </div>
        )}
        {company && (
          <>
            <p className="text-xs text-slate-500">{t.hint}</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">{t.contacts}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t.contactName}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t.role}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t.access}</th>
                    <th scope="col" className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {company.members.map((m) => (
                    <tr key={m.customerId}>
                      <td className="px-3 py-2">
                        <span className="bidi-auto font-medium text-slate-900">{m.name}</span>
                        <span className="block text-xs text-slate-500" dir="ltr">
                          {m.email}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Select aria-label={`${t.role}: ${m.name}`} className="h-8 w-auto text-xs" value={m.role} disabled={!canEdit || busy === m.customerId} onChange={(e) => call(m.customerId, () => api(`/api/admin/customers/${customerId}/company/contacts/${m.customerId}`, { method: "PATCH", body: { role: e.target.value, access: m.access } }))}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t.roles[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select aria-label={`${t.access}: ${m.name}`} className="h-8 w-auto text-xs" value={m.access} disabled={!canEdit || busy === m.customerId} onChange={(e) => call(m.customerId, () => api(`/api/admin/customers/${customerId}/company/contacts/${m.customerId}`, { method: "PATCH", body: { role: m.role, access: e.target.value } }))}>
                          {ACCESS.map((a) => (
                            <option key={a} value={a}>
                              {t.accessValues[a]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-end">
                        {canEdit && company.members.length > 1 && (
                          <Button variant="ghost" size="icon" aria-label={fmt(t.remove, { name: m.name })} disabled={busy === m.customerId} onClick={() => confirm(t.removeConfirm) && call(m.customerId, () => api(`/api/admin/customers/${customerId}/company/contacts/${m.customerId}`, { method: "DELETE" }))}>
                            <Trash2 className="size-4 text-slate-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && !adding && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> {t.addContact}
              </Button>
            )}
            {canEdit && adding && (
              <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
                <legend className="px-1 text-sm font-semibold">{t.addContact}</legend>
                <Field label={t.contactName} required>{(p) => <Input {...p} value={c.name} maxLength={120} onChange={(e) => setC({ ...c, name: e.target.value })} />}</Field>
                <Field label={t.contactEmail} required>{(p) => <Input {...p} type="email" dir="ltr" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />}</Field>
                <Field label={t.contactPhone}>{(p) => <Input {...p} type="tel" dir="ltr" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />}</Field>
                <Field label={t.role}>
                  {(p) => (
                    <Select {...p} value={c.role} onChange={(e) => setC({ ...c, role: e.target.value as OrgRole })}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t.roles[r]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t.access}>
                  {(p) => (
                    <Select {...p} value={c.access} onChange={(e) => setC({ ...c, access: e.target.value as OrgAccess })}>
                      {ACCESS.map((a) => (
                        <option key={a} value={a}>
                          {t.accessValues[a]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex items-end justify-end gap-2">
                  <Button variant="ghost" onClick={() => setAdding(false)}>
                    {d.common.cancel}
                  </Button>
                  <Button
                    loading={busy === "add"}
                    disabled={!c.name.trim() || !c.email.includes("@")}
                    onClick={() =>
                      call(
                        "add",
                        () => api(`/api/admin/customers/${customerId}/company/contacts`, { body: { name: c.name, email: c.email, phone: c.phone || null, role: c.role, access: c.access } }),
                        () => {
                          setAdding(false);
                          setC({ name: "", email: "", phone: "", role: "contact", access: "all" });
                        },
                        t.added,
                      )
                    }
                  >
                    {t.addContact}
                  </Button>
                </div>
              </fieldset>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
