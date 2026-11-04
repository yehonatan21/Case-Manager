import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaffRole } from "@/lib/domain";
import { env } from "@/lib/env";
import { PublicHeader } from "@/components/app/public-header";
import { LoginForm } from "@/components/app/login-form";
import { RegisterForm } from "@/components/app/register-form";
import { GoogleButton } from "@/components/app/google-button";
import { AuthTabs } from "@/components/app/auth-tabs";
import { Notice } from "@/components/ui/misc";
import { GOOGLE_SIGNUP_COOKIE, googleEnabled, readPendingGoogleSignup } from "@/lib/services/google";

export type AuthSearchParams = { next?: string; error?: string; as?: string; google?: string };

/** Shared sign-in / registration page, served at both /login and /register. */
export async function AuthPage({ tab, sp }: { tab: "login" | "register"; sp: AuthSearchParams }) {
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : null;
  const user = await getCurrentUser();
  if (user) redirect(next ?? (isStaffRole(user.role) ? "/admin" : "/portal"));
  const { d } = await getDict();
  const demo = env.seedDemoData && (!env.isProd || env.demoMode);
  const google = googleEnabled();
  // A first Google sign-in comes back here to accept the terms before the account is created.
  const pending = sp.google ? readPendingGoogleSignup((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value) : null;
  const initialTab = pending ? "register" : tab;

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">{d.login.authTitle}</h1>
        <p className="mt-1 text-slate-600">{d.login.authSubtitle}</p>

        {sp.error && (
          <Notice tone="danger" className="mt-4">
            {sp.error === "account_disabled" ? d.errors.account_disabled : sp.error === "google_cancelled" ? d.register.googleCancelled : d.register.googleFailed}
          </Notice>
        )}
        {sp.google && !pending && (
          <Notice tone="warning" className="mt-4">
            {d.register.googleExpired}
          </Notice>
        )}

        {google && !pending && (
          <div className="mx-auto mt-6 max-w-md">
            <GoogleButton next={next ?? undefined} />
            <div className="mt-6 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {d.register.orEmail}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        )}

        <AuthTabs
          initialTab={initialTab}
          login={
            <>
              <LoginForm key={sp.as ?? ""} next={next} initialEmail={demo && sp.as ? sp.as : undefined} />
              <p className="mt-4 text-sm text-slate-500">{d.login.staffHint}</p>
              {demo && (
                <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm">
                  <p className="font-semibold text-slate-800">{d.login.demoTitle}</p>
                  <p className="mt-1 text-slate-500">{d.login.demoText}</p>
                  <ul className="mt-2 space-y-1 text-xs" dir="ltr">
                    {[
                      [env.adminEmail, d.roles.admin],
                      ["manager@example.com", d.roles.case_manager],
                      ["staff@example.com", d.roles.staff],
                      ["finance@example.com", d.roles.finance],
                      ["client@example.com", d.roles.customer],
                      ["biz@example.com", d.customerType.company],
                    ].map(([email, role]) => (
                      <li key={email}>
                        <a
                          href={`/login?as=${encodeURIComponent(email!)}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                          className="flex justify-between gap-3 rounded-md px-2 py-1.5 font-mono text-slate-700 hover:bg-brand-50 hover:text-brand-800"
                        >
                          <span>{email}</span>
                          <span className="font-sans text-slate-500">{role}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          }
          register={<RegisterForm next={next} google={false} googleProfile={pending ?? undefined} />}
        />
      </main>
    </>
  );
}
