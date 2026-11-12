import { Check, FileCheck2, MessageCircleQuestion, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";
import { StartRequest } from "@/components/intake/start-request";

/** A glimpse of the flow beside the request box: the conversation, what was understood, the quote, the stages. Decorative. */
function HeroPreview({ p, stages }: { p: Awaited<ReturnType<typeof getDict>>["d"]["home"]["preview"]; stages: string[] }) {
  return (
    <div aria-hidden className="relative hidden lg:block">
      <div className="paper-grain absolute -inset-6 rounded-[2rem] opacity-60" />
      <div className="relative space-y-3">
        <div className="ms-auto w-[78%] rounded-2xl rounded-se-sm bg-accent px-4 py-3 text-sm text-white shadow-float">{p.user}</div>
        <div className="w-[82%] rounded-2xl rounded-ss-sm bg-card px-4 py-3 text-sm shadow-card">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-violet-700">
            <Sparkles className="size-3" /> {p.assistant}
          </span>
          {p.question}
        </div>
        <div className="rounded-card bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{p.understood}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              <span className="size-1.5 rounded-full bg-emerald-600" />
              {p.progress}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">{p.destination}</dt>
            <dd className="font-medium">{p.destinationValue}</dd>
            <dt className="text-slate-500">{p.people}</dt>
            <dd className="font-medium">4</dd>
            <dt className="text-slate-500">{p.service}</dt>
            <dd className="font-medium">{p.serviceValue}</dd>
          </dl>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card">
          <div>
            <div className="text-xs text-slate-500">{p.quote}</div>
            <div className="font-display text-2xl font-bold tabular-nums">₪2,950</div>
          </div>
          <span className="rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white">{p.approve}</span>
        </div>
        <div className="rounded-card bg-card p-5 shadow-card">
          <ol className="flex items-start justify-between">
            {stages.map((s, i) => (
              <li key={s} className="flex flex-1 flex-col items-center gap-1.5 text-center text-xs text-slate-500">
                <span
                  className={
                    i < 2
                      ? "grid size-7 place-items-center rounded-full bg-accent text-white"
                      : i === 2
                        ? "grid size-7 place-items-center rounded-full border-2 border-brand-700 bg-brand-50 text-xs font-semibold text-brand-800"
                        : "grid size-7 place-items-center rounded-full border border-slate-300 bg-card text-xs"
                  }
                >
                  {i < 2 ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={i === 2 ? "font-semibold text-slate-900" : ""}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const { d } = await getDict();
  const icons = [MessageCircleQuestion, FileCheck2, UserCheck];
  const c = d.status.client;
  const stages = [c.received, c.in_review, c.quote_ready, c.awaiting_payment, c.in_progress, c.completed];
  return (
    <>
      <PublicHeader />
      <main id="main">
        <section className="bg-hero">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:pt-16 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800">
                <Sparkles className="size-3.5" aria-hidden />
                {d.home.eyebrow}
              </p>
              <h1 className="font-display text-[2.5rem] font-extrabold leading-[1.08] text-slate-900 sm:text-[3.5rem]">
                {d.home.title}
                <span className="block text-brand-700">{d.home.titleAccent}</span>
              </h1>
              <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-slate-600">{d.home.subtitle}</p>
              <div className="mt-8">
                <StartRequest />
              </div>
            </div>
            <HeroPreview p={d.home.preview} stages={stages} />
          </div>
        </section>

        <section className="border-y border-slate-200 bg-card/60">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="font-display text-3xl font-bold">{d.home.howTitle}</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {d.home.steps.map((s, i) => {
                const Icon = icons[i]!;
                return (
                  <li key={s.title} className="relative overflow-hidden rounded-card bg-card p-6 shadow-card">
                    <span aria-hidden className="absolute -top-4 end-3 font-display text-[5.5rem] font-extrabold leading-none text-brand-700/10">
                      {i + 1}
                    </span>
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-100 text-brand-700">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-slate-900">{s.title}</h3>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-slate-600">{s.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="theme-ink grid gap-8 rounded-3xl bg-surface p-8 text-slate-900 md:grid-cols-[1fr_2fr] md:p-10">
            <div>
              <ShieldCheck className="size-8 text-brand-700" aria-hidden />
              <h2 className="mt-3 font-display text-2xl font-bold">{d.home.trustTitle}</h2>
            </div>
            <ul className="grid gap-5 sm:grid-cols-3">
              {d.home.trust.map((t) => (
                <li key={t} className="flex gap-2.5 text-[0.9375rem] leading-relaxed text-slate-700">
                  <Check className="mt-1 size-4 shrink-0 text-brand-700" aria-hidden />
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
