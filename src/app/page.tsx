import { MessageSquareText, FileCheck2, Activity, ShieldCheck } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";
import { StartRequest } from "@/components/intake/start-request";

export default async function HomePage() {
  const { d } = await getDict();
  const icons = [MessageSquareText, FileCheck2, Activity];
  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-[radial-gradient(ellipse_at_center,var(--color-brand-100),transparent_70%)]" />
          <div className="relative mx-auto max-w-3xl px-4 pb-16 pt-12 sm:pt-20">
            <p className="mb-3 text-sm font-semibold text-brand-700">{d.home.eyebrow}</p>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{d.home.title}</h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">{d.home.subtitle}</p>
            <div className="mt-8">
              <StartRequest />
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-card">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight">{d.home.howTitle}</h2>
            <ol className="mt-8 grid gap-5 sm:grid-cols-3">
              {d.home.steps.map((s, i) => {
                const Icon = icons[i]!;
                return (
                  <li key={s.title} className="rounded-xl border border-slate-200 bg-surface p-5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-white">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="text-sm font-semibold text-brand-700">{i + 1}</span>
                    </div>
                    <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <div className="rounded-card bg-card shadow-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-6 text-emerald-600" aria-hidden />
              <h2 className="text-xl font-bold">{d.home.trustTitle}</h2>
            </div>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {d.home.trust.map((t) => (
                <li key={t} className="text-sm leading-relaxed text-slate-600">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
