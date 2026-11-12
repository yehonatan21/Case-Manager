"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import type { UserRole } from "@/lib/db/schema";
import { useSave } from "./use-save";

export type StaffMember = { id: string; name: string; email: string; role: UserRole; status: "active" | "invited" | "disabled"; hourlyCostCents?: number | null; twoFactor?: boolean };

const STAFF_ROLES: UserRole[] = ["admin", "case_manager", "staff", "finance"];

/** Settings → Users: invite a team member; change role, status, cost per hour; reset two-step sign-in. */
export function UsersSettings({ staff, currentUserId }: { staff: StaffMember[]; currentUserId: string }) {
  const { d } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { busy, setBusy, call } = useSave();
  const [invite, setInvite] = useState({ email: "", name: "", role: "case_manager" as UserRole });
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <Field label={d.common.name} className="min-w-40 flex-1">
            {(p) => <Input {...p} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />}
          </Field>
          <Field label={d.common.email} className="min-w-52 flex-1">
            {(p) => <Input {...p} dir="ltr" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}
          </Field>
          <Field label={d.admin.col.role}>
            {(p) => (
              <Select {...p} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as UserRole })}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {d.roles[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            loading={busy === "invite"}
            disabled={!invite.name.trim() || !invite.email.includes("@")}
            onClick={async () => {
              setBusy("invite");
              try {
                const r = await api<{ outcome: "invited" | "converted" | "reactivated" }>("/api/admin/users", { body: invite });
                const msg = { invited: d.settingsPage.inviteDone, converted: d.settingsPage.inviteConverted, reactivated: d.settingsPage.inviteReactivated }[r.outcome];
                toast("success", fmt(msg, { email: invite.email.trim() }));
                setInvite({ email: "", name: "", role: "case_manager" });
                router.refresh();
              } catch (e) {
                toast("error", errorText(e, d));
              } finally {
                setBusy(null);
              }
            }}
          >
            <Plus className="size-4" /> {d.settingsPage.invite}
          </Button>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-card bg-card shadow-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{d.common.name}</th>
              <th className="px-4 py-3 text-start font-medium">{d.common.email}</th>
              <th className="px-4 py-3 text-start font-medium">{d.admin.col.role}</th>
              <th className="px-4 py-3 text-start font-medium">{d.common.status}</th>
              <th className="px-4 py-3 text-start font-medium">{d.twoFactor.usersColumn}</th>
              <th className="px-4 py-3 text-start font-medium">
                <span title={d.time.hourlyCostHint}>{d.time.hourlyCost}</span>
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((u) => (
              <tr key={u.id}>
                <td className="bidi-auto px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-600" dir="ltr">
                  {u.email}
                </td>
                <td className="px-4 py-3">
                  <Select
                    aria-label={d.admin.col.role}
                    value={u.role}
                    disabled={u.id === currentUserId}
                    className="h-8 w-auto text-xs"
                    onChange={(e) => call(u.id, () => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                  >
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {d.roles[r]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={u.status === "active" ? "success" : u.status === "invited" ? "info" : "muted"}>{d.userStatus[u.status]}</Badge>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1">
                    <Badge tone={u.twoFactor ? "success" : "muted"}>{u.twoFactor ? d.twoFactor.statusOn : d.twoFactor.statusOff}</Badge>
                    {u.twoFactor && u.id !== currentUserId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${d.twoFactor.reset}: ${u.name}`}
                        title={d.twoFactor.reset}
                        loading={busy === `2fa-${u.id}`}
                        onClick={() => {
                          if (window.confirm(fmt(d.twoFactor.resetConfirm, { name: u.name }))) void call(`2fa-${u.id}`, () => api(`/api/admin/users/${u.id}/2fa`, { method: "DELETE" }));
                        }}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    dir="ltr"
                    aria-label={`${d.time.hourlyCost}: ${u.name}`}
                    title={d.time.hourlyCostHint}
                    className="h-8 w-24 text-xs"
                    defaultValue={u.hourlyCostCents != null ? u.hourlyCostCents / 100 : ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      const cents = v === "" ? null : Math.round(Number(v) * 100);
                      if (cents === (u.hourlyCostCents ?? null) || (cents !== null && !(cents >= 0))) return;
                      void call(`cost-${u.id}`, () => api(`/api/admin/users/${u.id}/cost`, { method: "PUT", body: { cents } }));
                    }}
                  />
                </td>
                <td className="px-4 py-3 text-end">
                  {u.id !== currentUserId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === u.id}
                      onClick={() => call(u.id, () => api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { status: u.status === "disabled" ? "active" : "disabled" } }))}
                    >
                      {u.status === "disabled" ? d.settingsPage.enable : d.settingsPage.disable}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
