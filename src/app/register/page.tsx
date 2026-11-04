import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isStaffRole } from "@/lib/domain";
import { PublicHeader } from "@/components/app/public-header";
import { RegisterForm } from "@/components/app/register-form";
import { Notice } from "@/components/ui/misc";
import { GOOGLE_SIGNUP_COOKIE, googleEnabled, readPendingGoogleSignup } from "@/lib/services/google";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.register.pageTitle };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; google?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : null;
  if (user) redirect(next ?? (isStaffRole(user.role) ? "/admin" : "/portal"));
  const { d } = await getDict();
  const pending = sp.google ? readPendingGoogleSignup((await cookies()).get(GOOGLE_SIGNUP_COOKIE)?.value) : null;
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">{d.register.pageTitle}</h1>
        {sp.google && !pending && (
          <Notice tone="warning" className="mt-4">
            {d.register.googleExpired}
          </Notice>
        )}
        <RegisterForm next={next} google={googleEnabled()} googleProfile={pending ?? undefined} />
        <p className="mt-6 text-sm text-slate-600">
          {d.register.haveAccount}{" "}
          <a href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-700 hover:underline">
            {d.register.signIn}
          </a>
        </p>
      </main>
    </>
  );
}
