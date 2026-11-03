import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { PublicHeader } from "@/components/app/public-header";
import { LoginForm } from "@/components/app/login-form";
import { isStaffRole } from "@/lib/domain";
import { env } from "@/lib/env";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.login.title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(isStaffRole(user.role) ? "/admin" : "/portal");
  const { d } = await getDict();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const demo = env.seedDemoData && !env.isProd;
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold">{d.login.title}</h1>
        <p className="mt-1 text-slate-600">{d.login.subtitle}</p>
        <LoginForm next={safeNext} />
        <p className="mt-6 text-sm text-slate-500">{d.login.noAccount}</p>
        <p className="mt-2 text-sm text-slate-500">{d.login.staffHint}</p>
        {demo && (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm">
            <p className="font-semibold text-slate-800">{d.login.demoTitle}</p>
            <p className="mt-1 text-slate-500">{d.login.demoText}</p>
            <ul className="mt-2 space-y-1 font-mono text-xs text-slate-700" dir="ltr">
              <li>{env.adminEmail} — admin</li>
              <li>manager@example.com — case manager</li>
              <li>staff@example.com — staff</li>
              <li>finance@example.com — finance</li>
              <li>client@example.com — customer</li>
              <li>biz@example.com — business customer</li>
            </ul>
          </div>
        )}
      </main>
    </>
  );
}
