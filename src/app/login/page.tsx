import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { PublicHeader } from "@/components/app/public-header";
import { LoginForm } from "@/components/app/login-form";
import { isStaffRole } from "@/lib/domain";
import { env } from "@/lib/env";
import { googleEnabled } from "@/lib/services/google";
import { GoogleButton } from "@/components/app/google-button";
import { Notice } from "@/components/ui/misc";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.login.title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; as?: string }> }) {
  const { next, error, as } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(isStaffRole(user.role) ? "/admin" : "/portal");
  const { d } = await getDict();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const demo = env.seedDemoData && (!env.isProd || env.demoMode);
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold">{d.login.title}</h1>
        <p className="mt-1 text-slate-600">{d.login.subtitle}</p>
        {error && (
          <Notice tone="danger" className="mt-4">
            {error === "account_disabled" ? d.errors.account_disabled : error === "google_cancelled" ? d.register.googleCancelled : d.register.googleFailed}
          </Notice>
        )}
        {googleEnabled() && (
          <div className="mt-6">
            <GoogleButton next={safeNext ?? undefined} />
            <div className="mt-6 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {d.register.orEmail}
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        )}
        <LoginForm key={as ?? ""} next={safeNext} initialEmail={demo && as ? as : undefined} />
        <p className="mt-6 text-sm text-slate-600">
          {d.register.noAccount}{" "}
          <a href={`/register${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`} className="font-semibold text-brand-700 hover:underline">
            {d.register.createLink}
          </a>
        </p>
        <p className="mt-2 text-sm text-slate-500">{d.login.staffHint}</p>
        {demo && (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm">
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
                    href={`/login?as=${encodeURIComponent(email!)}${safeNext ? `&next=${encodeURIComponent(safeNext)}` : ""}`}
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
      </main>
    </>
  );
}
