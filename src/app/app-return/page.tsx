import { CheckCircle2, AlertCircle } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { appReturnLink } from "@/lib/services/app-sign-in";
import { OpenAppLink } from "@/components/native/open-app-link";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.appReturn.pageTitle, robots: { index: false } };
}

/**
 * The end of Google sign-in started from the iPhone/Android app: the system browser lands here and hands the
 * one-time code back to the app through its URL scheme (opened automatically, with a button as a fallback).
 */
export default async function AppReturnPage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const sp = await searchParams;
  const { d } = await getDict();
  const t = d.appReturn;
  const code = sp.code && /^[A-Za-z0-9_-]{16,200}$/.test(sp.code) ? sp.code : null;
  const error = code ? null : (sp.error ?? "google_failed").replace(/[^a-z_]/g, "").slice(0, 40) || "google_failed";
  const href = code ? appReturnLink({ code }) : appReturnLink({ error: error! });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      {code ? <CheckCircle2 className="size-12 text-emerald-600" aria-hidden /> : <AlertCircle className="size-12 text-amber-600" aria-hidden />}
      <h1 className="text-2xl font-bold text-slate-900">{code ? t.title : t.errorTitle}</h1>
      <p className="text-slate-700">{code ? t.text : t.errorText}</p>
      <OpenAppLink href={href} label={t.back} />
    </main>
  );
}
