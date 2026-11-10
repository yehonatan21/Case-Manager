import { cookies } from "next/headers";
import { parseHiddenPanels, WORKSPACE_PANELS_COOKIE } from "@/components/admin/workspace/types";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCaseBundle, markCaseRead } from "@/lib/services/cases";
import { listAssignableStaff } from "@/lib/services/users";
import { listTemplates } from "@/lib/services/catalog";
import { aiIsMock, recommendations } from "@/lib/services/copilot";
import { CaseWorkspace } from "@/components/admin/workspace/workspace";
import { RealtimeRefresher } from "@/components/app/realtime";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { env } from "@/lib/env";
import { listCaseMeetings } from "@/lib/services/meetings";
import { getCaseFeedback } from "@/lib/services/feedback";
import { getSettings } from "@/lib/services/settings";
import { officeToday } from "@/lib/services/queue";

export default async function CaseWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; new?: string }> }) {
  const { id } = await params;
  const { tab, new: startNew } = await searchParams;
  const user = await requirePageStaff(`/admin/cases/${id}`);
  const { d } = await getDict();
  const db = await getDb();
  let b;
  try {
    b = await getCaseBundle(db, user, id);
  } catch {
    return <EmptyState title={d.caseView.notFound} text={d.states.notFoundText} action={<ButtonLink href="/admin/cases">{d.admin.casesTitle}</ButtonLink>} />;
  }
  await markCaseRead(db, user, id);
  const [staff, templates, meetingList, settings] = await Promise.all([listAssignableStaff(db), listTemplates(db, true), listCaseMeetings(db, user, id), getSettings(db)]);
  const feedback = await getCaseFeedback(db, id);
  return (
    <>
      <RealtimeRefresher caseId={id} />
      <CaseWorkspace
        // A fresh workspace for another case, or when Quick Create opens this one on another tab with a form ready.
        key={`${id}:${startNew ?? ""}:${startNew ? (tab ?? "") : ""}`}
        currentUserId={user.id}
        currentRole={user.role}
        aiMock={aiIsMock()}
        initialTab={tab}
        startNew={startNew === "task" || startNew === "meeting" ? startNew : undefined}
        initialHidden={parseHiddenPanels((await cookies()).get(WORKSPACE_PANELS_COOKIE)?.value)}
        maxMb={Math.round(env.maxUploadBytes / 1024 / 1024)}
        staff={staff}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, documents: t.documents }))}
        meetings={meetingList}
        meetingDurations={settings.meeting_durations}
        currency={settings.currency}
        c={{
          id: b.case.id,
          number: b.case.number,
          title: b.case.title,
          description: b.case.description,
          goal: b.case.goal,
          status: b.case.status,
          urgency: b.case.urgency,
          serviceCategory: b.case.serviceCategory,
          createdAt: b.case.createdAt,
          assigneeId: b.case.assigneeId,
          dueDate: b.case.dueDate,
          waitingOnThirdParty: b.case.waitingOnThirdParty,
          waitingNote: b.case.waitingNote,
          lastActivityAt: [b.case.lastClientActivityAt, b.case.lastStaffActivityAt, b.case.createdAt].filter(Boolean).map((x) => new Date(x!)).sort((x, y) => y.getTime() - x.getTime())[0]!,
          today: officeToday(),
          intakeSummary: b.access.internal ? b.case.intakeSummary : null,
          aiSummary: b.access.internal ? b.case.aiSummary : null,
          customer: b.customer
            ? {
                name: b.customer.user.name,
                email: b.customer.user.email,
                phone: b.customer.user.phone,
                type: b.customer.type,
                organization: b.customer.organization?.name ?? null,
                customerId: b.customer.id,
                aiConsent: !!b.customer.user.aiConsentAt,
                locale: b.customer.user.locale,
              }
            : null,
          feedback: feedback ? { rating: feedback.rating, comment: feedback.comment, createdAt: feedback.createdAt } : null,
          access: b.access,
          events: b.events.map((e) => ({ id: e.id, type: e.type, visibility: e.visibility, actorKind: e.actorKind, actorName: e.actorName, data: e.data, createdAt: e.createdAt })),
          messages: b.messages.map((m) => ({ id: m.id, senderId: m.senderId, senderName: m.senderName, senderRole: m.senderRole, kind: m.kind, body: m.body, isInfoRequest: m.isInfoRequest, via: m.via, aiRunId: m.aiRunId, createdAt: m.createdAt })),
          documents: b.documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            status: doc.status,
            visibility: doc.visibility,
            required: doc.required,
            requested: doc.requestedById !== null,
            reminderCount: doc.reminderCount,
            requestNote: doc.requestNote,
            reviewNote: doc.reviewNote,
            aiAnalysis: doc.aiAnalysis,
            details: doc.details,
            detailsConfirmedBy: doc.detailsConfirmedById ? (staff.find((s) => s.id === doc.detailsConfirmedById)?.name ?? null) : null,
            files: doc.files.map((f) => ({ id: f.id, version: f.version, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, scanStatus: f.scanStatus, createdAt: f.createdAt, uploaderName: f.uploaderName })),
            // The latest signature request on the document (cancelled ones are hidden from clients by the bundle).
            signature: b.signatures.find((x) => x.documentId === doc.id && x.status !== "cancelled") ?? null,
          })),
          tasks: b.tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status, priority: t.priority, requiresClientAction: t.requiresClientAction, dependsOnId: t.dependsOnId, milestoneId: t.milestoneId })),
          milestones: b.milestones.map((m) => ({ id: m.id, title: m.title, dueDate: m.dueDate, clientVisible: m.clientVisible, completedAt: m.completedAt })),
          quotes: b.quotes.map((q) => ({ id: q.id, version: q.version, status: q.status, expired: q.expired, serviceName: q.serviceName, totalCents: q.totalCents, currency: q.currency, sentAt: q.sentAt, approvedAt: q.approvedAt, updatedAt: q.updatedAt })),
          payments: b.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, currency: p.currency, status: p.status, provider: p.provider, createdAt: p.createdAt, paidAt: p.paidAt })),
          recommendations: b.access.internal ? recommendations(b).map((r) => r.kind) : [],
        }}
      />
    </>
  );
}
