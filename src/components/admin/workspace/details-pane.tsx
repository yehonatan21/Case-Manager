"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Mail, Phone, ShieldOff, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { formatDate } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Label } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { CaseStatusBadge } from "@/components/app/status";
import { MANUAL_TRANSITIONS } from "@/lib/domain";
import { fmt } from "@/lib/i18n/config";
import { useCategories } from "@/components/app/categories";
import { Stars } from "@/components/case/feedback-card";
import type { CaseStatus, Urgency } from "@/lib/db/schema";
import type { StaffOption, WorkspaceData } from "./types";

export function DetailsPane({ c, staff, currentUserId }: { c: WorkspaceData; staff: StaffOption[]; currentUserId: string }) {
  const { d, locale } = useI18n();
  const categories = useCategories();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = c.access.edit;

  const patch = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      await api(`/api/cases/${c.id}`, { method: "PATCH", body });
      toast("success", d.common.saved);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: CaseStatus) => {
    if (status === "completed" && !confirm(d.workspace.completeConfirm)) return;
    setBusy("status");
    try {
      await api(`/api/cases/${c.id}/status`, { method: "PATCH", body: { status } });
      toast("success", d.workspace.statusUpdated);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const transitions = MANUAL_TRANSITIONS[c.status] ?? [];
  const intake = c.intakeSummary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{d.workspace.customer}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {c.customer ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                <UserRound className="size-4 text-slate-400" aria-hidden />
                <span className="bidi-auto">{c.customer.name}</span>
              </p>
              <p className="flex items-center gap-2 text-slate-600">
                <Mail className="size-4 text-slate-400" aria-hidden />
                <a href={`mailto:${c.customer.email}`} dir="ltr" className="hover:underline">
                  {c.customer.email}
                </a>
              </p>
              {c.customer.phone && (
                <p className="flex items-center gap-2 text-slate-600">
                  <Phone className="size-4 text-slate-400" aria-hidden />
                  <span dir="ltr">{c.customer.phone}</span>
                </p>
              )}
              <p className="flex items-center gap-2 text-slate-600">
                <Building2 className="size-4 text-slate-400" aria-hidden />
                {d.customerType[c.customer.type as "private"]}
                {c.customer.organization && <> · {c.customer.organization}</>}
              </p>
              {!c.customer.aiConsent && (
                <Badge tone="warning">
                  <ShieldOff className="size-3" aria-hidden /> {d.copilot.noConsentShort}
                </Badge>
              )}
              {(c.status === "completed" || c.status === "closed") && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <p className="text-xs font-medium text-slate-500">{d.feedback.staffTitle}</p>
                  {c.feedback ? (
                    <>
                      <p className="flex items-center gap-1.5 text-sm text-slate-800">
                        <Stars value={c.feedback.rating} /> <span>{fmt(d.feedback.stars, { n: c.feedback.rating })}</span>
                      </p>
                      {c.feedback.comment && <p className="bidi-auto mt-0.5 text-sm text-slate-600">{c.feedback.comment}</p>}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">{d.feedback.noFeedback}</p>
                  )}
                </div>
              )}
            </>
          ) : (
            "—"
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{d.workspace.details}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">{d.common.status}</span>
            <CaseStatusBadge status={c.status} />
          </div>
          {canEdit && transitions.length > 0 && (
            <div>
              <Label htmlFor="ws-status">{d.workspace.changeStatus}</Label>
              <Select
                id="ws-status"
                value=""
                disabled={busy === "status"}
                onChange={(e) => e.target.value && setStatus(e.target.value as CaseStatus)}
              >
                <option value="">{d.workspace.moveTo}</option>
                {transitions.map((s) => (
                  <option key={s} value={s}>
                    {d.status.internal[s]}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {canEdit && c.status === "submitted" && (
            <Button className="w-full" onClick={() => setStatus("under_review")} loading={busy === "status"} title={d.workspace.reviewRequestHint}>
              {d.workspace.reviewRequest}
            </Button>
          )}
          {canEdit && (c.status === "active" || c.status === "awaiting_client") && (
            <Button className="w-full" variant="secondary" onClick={() => setStatus("completed")} loading={busy === "status"}>
              {d.workspace.completeCase}
            </Button>
          )}
          <div>
            <Label htmlFor="ws-assignee">{d.workspace.assignee}</Label>
            {c.access.assign ? (
              <div className="flex gap-2">
                <Select id="ws-assignee" value={c.assigneeId ?? ""} disabled={busy === "assign"} onChange={(e) => patch("assign", { assigneeId: e.target.value || null })}>
                  <option value="">{d.common.unassigned}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({d.roles[s.role]})
                    </option>
                  ))}
                </Select>
                {c.assigneeId !== currentUserId && (
                  <Button variant="outline" size="md" onClick={() => patch("assign", { assigneeId: currentUserId })}>
                    {d.common.assignToMe}
                  </Button>
                )}
              </div>
            ) : (
              <p>{staff.find((s) => s.id === c.assigneeId)?.name ?? d.common.unassigned}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ws-urgency">{d.workspace.urgency}</Label>
              <Select id="ws-urgency" value={c.urgency} disabled={!canEdit} onChange={(e) => patch("urgency", { urgency: e.target.value as Urgency })}>
                {(["low", "normal", "high", "urgent"] as const).map((u) => (
                  <option key={u} value={u}>
                    {d.urgency[u]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ws-cat">{d.workspace.category}</Label>
              <Select id="ws-cat" value={c.serviceCategory} disabled={!canEdit} onChange={(e) => patch("cat", { serviceCategory: e.target.value })}>
                {/* A hidden type the case still has stays selectable so the select shows it. */}
                {!categories.list.some((x) => x.key === c.serviceCategory) && <option value={c.serviceCategory}>{categories.label(c.serviceCategory)}</option>}
                {categories.list.map((s) => (
                  <option key={s.key} value={s.key}>
                    {categories.label(s.key)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {d.workspace.opened}: {formatDate(c.createdAt, locale)}
          </p>
        </CardContent>
      </Card>

      {(intake || c.description) && c.access.internal && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{d.workspace.intakeSummary}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {c.goal && (
              <p>
                <span className="font-medium text-slate-700">{d.review.goal}: </span>
                <span className="bidi-auto">{c.goal}</span>
              </p>
            )}
            <p className="bidi-auto whitespace-pre-line text-slate-700">{c.description}</p>
            {intake && intake.known_facts.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">{d.review.knownFacts}</p>
                <ul className="mt-1 space-y-0.5">
                  {intake.known_facts.map((f, i) => (
                    <li key={i} className="bidi-auto">
                      <span className="text-slate-500">{f.label}:</span> {f.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intake && intake.constraints.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">{d.review.constraints}</p>
                <ul className="mt-1 list-inside list-disc">
                  {intake.constraints.map((x, i) => (
                    <li key={i} className="bidi-auto">{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {intake && intake.missing_information.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500">{d.review.missingInfo}</p>
                <ul className="mt-1 list-inside list-disc text-amber-800">
                  {intake.missing_information.map((x, i) => (
                    <li key={i} className="bidi-auto">{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
