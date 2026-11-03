import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getQuoteForEditor } from "@/lib/services/quotes";
import { listPriceList } from "@/lib/services/catalog";
import { QuoteEditor } from "@/components/admin/quote-editor/quote-editor";
import { EmptyState } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.quoteEditor.title };
}

export default async function QuoteEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string }> }) {
  const { id } = await params;
  const { ai } = await searchParams;
  const user = await requirePageStaff(`/admin/quotes/${id}`);
  const { d } = await getDict();
  const db = await getDb();
  let r;
  try {
    r = await getQuoteForEditor(db, user, id);
  } catch {
    return <EmptyState title={d.states.notFoundTitle} action={<ButtonLink href="/admin/quotes">{d.admin.quotesTitle}</ButtonLink>} />;
  }
  const priceList = (await listPriceList(db, true)).map((p) => ({ id: p.id, code: p.code, name: p.name, unitPriceCents: p.unitPriceCents, currency: p.currency }));
  return (
    <QuoteEditor
      canManage={r.access.manageQuotes}
      autoDraft={ai === "1"}
      priceList={priceList}
      q={{
        id: r.quote.id,
        caseId: r.case.id,
        caseNumber: r.case.number,
        customerName: r.customer?.name ?? "",
        version: r.quote.version,
        status: r.quote.status,
        expired: r.expired,
        serviceName: r.quote.serviceName,
        scope: r.quote.scope,
        included: r.quote.included,
        excluded: r.quote.excluded,
        currency: r.quote.currency,
        taxRate: r.quote.taxRate,
        pricesIncludeTax: r.quote.pricesIncludeTax,
        paymentTerms: r.quote.paymentTerms,
        timeline: r.quote.timeline,
        terms: r.quote.terms,
        validUntil: r.quote.validUntil,
        subtotalCents: r.quote.subtotalCents,
        taxCents: r.quote.taxCents,
        totalCents: r.quote.totalCents,
        items: r.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents, priceListItemId: i.priceListItemId })),
      }}
    />
  );
}
