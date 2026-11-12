import { CheckCircle2 } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import { deletionPreview } from "@/lib/services/account-deletion";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";
import { ButtonLink } from "@/components/ui/button";
import { DeleteAccountCard } from "@/components/account/delete-account";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.accountDeletion.pageTitle };
}

/**
 * How to delete an account, and the deletion itself for a signed-in client. The web address app stores ask for
 * (Google Play: "account deletion URL"); the app has the same card under Profile.
 */
export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const { d } = await getDict();
  const t = d.accountDeletion;
  const db = await getDb();
  const [user, settings] = await Promise.all([getCurrentUser(), getSettings(db)]);
  const contact = settings.company.email?.trim();
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        {sp.done ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <h1 className="text-xl font-bold text-emerald-950">{t.doneTitle}</h1>
              <p className="mt-1 text-emerald-900">{t.doneText}</p>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-slate-900">{t.pageTitle}</h1>
            {user?.role === "customer" ? (
              <DeleteAccountCard email={user.email} preview={await deletionPreview(db, user.id)} className="mt-6 rounded-xl border border-red-200 bg-white p-5" />
            ) : (
              <div className="mt-4 space-y-4 text-slate-700">
                <p>{t.intro}</p>
                <div>
                  <h2 className="font-semibold text-slate-900">{t.erasedTitle}</h2>
                  <p className="mt-0.5">{t.erased}</p>
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">{t.keptTitle}</h2>
                  <p className="mt-0.5">{t.kept}</p>
                </div>
                {user ? (
                  <p className="rounded-lg bg-slate-100 p-3 text-sm">{t.staffNote}</p>
                ) : (
                  <>
                    <p>{t.signedOutText}</p>
                    <ButtonLink href="/login?next=%2Fdelete-account">{t.signIn}</ButtonLink>
                    {contact && (
                      <p className="text-sm">
                        {t.orContact}{" "}
                        <a href={`mailto:${contact}`} dir="ltr" className="font-medium text-brand-700 underline">
                          {contact}
                        </a>
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
