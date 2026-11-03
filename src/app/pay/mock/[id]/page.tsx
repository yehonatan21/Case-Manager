import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { requirePageUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getPaymentForCheckoutPage } from "@/lib/services/payments";
import { env } from "@/lib/env";
import { MockCheckout } from "@/components/app/mock-checkout";
import { LanguageSwitcher } from "@/components/app/language-switcher";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.mockPay.title };
}

/** Simulated hosted checkout (PAYMENT_PROVIDER=mock). With Stripe, customers are redirected to Stripe Checkout instead. */
export default async function MockPayPage({ params }: { params: Promise<{ id: string }> }) {
  if (env.paymentProvider !== "mock") notFound();
  const { id } = await params;
  const user = await requirePageUser(`/pay/mock/${id}`);
  let row;
  try {
    row = await getPaymentForCheckoutPage(await getDb(), user, id);
  } catch {
    notFound();
  }
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="absolute end-4 top-4">
        <LanguageSwitcher compact />
      </div>
      <MockCheckout
        paymentId={row.p.id}
        caseId={row.p.caseId}
        status={row.p.status}
        amountCents={row.p.amountCents}
        currency={row.p.currency}
        service={row.serviceName}
        caseNumber={row.caseNumber}
      />
    </main>
  );
}
