import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { getCurrentUser, getPendingSecondStepUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";
import { SecondStepForm } from "@/components/account/second-step-form";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.twoFactor.pageTitle };
}

/** The second step of a staff sign-in: the code from the authenticator app. */
export default async function SecondStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/admin";
  if (await getCurrentUser()) redirect(next);
  const user = await getPendingSecondStepUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const { d } = await getDict();
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-md px-4 py-12">
        <div className="rounded-card bg-card shadow-card p-6">
          <h1 className="text-xl font-semibold">{d.twoFactor.signInTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">{fmt(d.twoFactor.signInHint, { app: env.appName })}</p>
          <p className="mt-1 text-sm text-slate-600" dir="ltr">
            {user.email}
          </p>
          <SecondStepForm next={next} />
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
