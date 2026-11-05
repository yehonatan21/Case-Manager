import { getDict } from "@/lib/i18n/server";
import { requirePageCustomer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getCaseBundle } from "@/lib/services/cases";
import { ClientCaseView } from "@/components/case/client-case-view";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { RealtimeRefresher } from "@/components/app/realtime";
import { env } from "@/lib/env";
import { activePaymentProvider } from "@/lib/services/payment-settings";
import { listCaseMeetings } from "@/lib/services/meetings";
import { getSettings } from "@/lib/services/settings";

export default async function CustomerCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; submitted?: string; payment?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requirePageCustomer(`/portal/cases/${id}`);
  const { d } = await getDict();
  const db = await getDb();
  let b;
  try {
    b = await getCaseBundle(db, user, id);
  } catch {
    return <EmptyState title={d.caseView.notFound} text={d.states.notFoundText} action={<ButtonLink href="/portal/cases">{d.portal.casesTitle}</ButtonLink>} />;
  }
  const [meetingList, settings] = await Promise.all([listCaseMeetings(db, user, id), getSettings(db)]);
  return (
    <>
      <RealtimeRefresher caseId={id} />
      <ClientCaseView
        userId={user.id}
        initialTab={sp.tab}
        submitted={sp.submitted === "1"}
        payment={sp.payment}
        maxMb={Math.round(env.maxUploadBytes / 1024 / 1024)}
        c={{
          id: b.case.id,
          number: b.case.number,
          title: b.case.title,
          description: b.case.description,
          goal: b.case.goal,
          status: b.case.status,
          createdAt: b.case.createdAt,
          updatedAt: b.case.updatedAt,
          assignee: b.assignee ? { name: b.assignee.name } : null,
          customerName: b.customer?.user.name ?? "",
          meetings: meetingList,
          meetingDurations: settings.meeting_durations,
          checkout: { provider: await activePaymentProvider(db), payerName: user.name, payerPhone: user.phone ?? "" },
          actions: b.actions,
          events: b.events.map((e) => ({ id: e.id, type: e.type, visibility: e.visibility, actorKind: e.actorKind, actorName: e.actorName, data: e.data, createdAt: e.createdAt })),
          messages: b.messages.map((m) => ({ id: m.id, senderId: m.senderId, senderName: m.senderName, senderRole: m.senderRole, kind: m.kind, body: m.body, isInfoRequest: m.isInfoRequest, via: m.via, aiRunId: null, createdAt: m.createdAt })),
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
            aiAnalysis: null,
            files: doc.files.map((f) => ({ id: f.id, version: f.version, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, scanStatus: f.scanStatus, createdAt: f.createdAt, uploaderName: f.uploaderName })),
            // The latest signature request on the document (cancelled ones are hidden from clients by the bundle).
            signature: b.signatures.find((x) => x.documentId === doc.id && x.status !== "cancelled") ?? null,
          })),
          // Only customer-facing quote fields cross to the browser.
          quotes: b.quotes.map((q) => ({
            id: q.id,
            version: q.version,
            status: q.status,
            expired: q.expired,
            serviceName: q.serviceName,
            scope: q.scope,
            included: q.included,
            excluded: q.excluded,
            currency: q.currency,
            taxRate: q.taxRate,
            pricesIncludeTax: q.pricesIncludeTax,
            subtotalCents: q.subtotalCents,
            taxCents: q.taxCents,
            totalCents: q.totalCents,
            paymentTerms: q.paymentTerms,
            timeline: q.timeline,
            terms: q.terms,
            validUntil: q.validUntil,
            approvedAt: q.approvedAt,
            declinedAt: q.declinedAt,
            items: q.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
          })),
          payments: b.payments.map((p) => ({ id: p.id, amountCents: p.amountCents, currency: p.currency, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt })),
        }}
      />
    </>
  );
}
