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

export default async function CaseWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
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
  const [staff, templates] = await Promise.all([listAssignableStaff(db), listTemplates(db, true)]);
  return (
    <>
      <RealtimeRefresher caseId={id} />
      <CaseWorkspace
        currentUserId={user.id}
        aiMock={aiIsMock()}
        initialTab={tab}
        maxMb={Math.round(env.maxUploadBytes / 1024 / 1024)}
        staff={staff}
        templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category }))}
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
              }
            : null,
          access: b.access,
          events: b.events.map((e) => ({ id: e.id, type: e.type, visibility: e.visibility, actorKind: e.actorKind, actorName: e.actorName, data: e.data, createdAt: e.createdAt })),
          messages: b.messages.map((m) => ({ id: m.id, senderId: m.senderId, senderName: m.senderName, senderRole: m.senderRole, kind: m.kind, body: m.body, isInfoRequest: m.isInfoRequest, aiRunId: m.aiRunId, createdAt: m.createdAt })),
          documents: b.documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            status: doc.status,
            visibility: doc.visibility,
            requestNote: doc.requestNote,
            reviewNote: doc.reviewNote,
            aiAnalysis: doc.aiAnalysis,
            files: doc.files.map((f) => ({ id: f.id, version: f.version, filename: f.filename, sizeBytes: f.sizeBytes, scanStatus: f.scanStatus, createdAt: f.createdAt, uploaderName: f.uploaderName })),
          })),
          tasks: b.tasks.map((t) => ({ id: t.id, title: t.title, description: t.description, assigneeId: t.assigneeId, dueDate: t.dueDate, status: t.status, priority: t.priority, requiresClientAction: t.requiresClientAction })),
          quotes: b.quotes.map((q) => ({ id: q.id, version: q.version, status: q.status, expired: q.expired, serviceName: q.serviceName, totalCents: q.totalCents, currency: q.currency, sentAt: q.sentAt, approvedAt: q.approvedAt, updatedAt: q.updatedAt })),
          payments: b.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, currency: p.currency, status: p.status, provider: p.provider, createdAt: p.createdAt, paidAt: p.paidAt })),
          recommendations: b.access.internal ? recommendations(b).map((r) => r.kind) : [],
        }}
      />
    </>
  );
}
