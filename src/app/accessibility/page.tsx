import { getDict } from "@/lib/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.accessibilityPage.title };
}

/** Accessibility statement (Israeli Equal Rights Regulations 2013, section 35; IS 5568 / WCAG 2.1 AA). */
export default async function AccessibilityPage() {
  const { d } = await getDict();
  const t = d.accessibilityPage;
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 leading-relaxed text-slate-700">
        <h1 className="text-3xl font-bold text-slate-900">{t.title}</h1>
        <p className="mt-6">{t.intro}</p>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t.standardTitle}</h2>
        <p className="mt-2">{t.standard}</p>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t.doneTitle}</h2>
        <ul className="mt-2 list-disc space-y-1.5 ps-6">
          {t.done.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t.supportTitle}</h2>
        <p className="mt-2">{t.support}</p>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t.limitsTitle}</h2>
        <ul className="mt-2 list-disc space-y-1.5 ps-6">
          {t.limits.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>

        <h2 className="mt-8 text-xl font-semibold text-slate-900">{t.contactTitle}</h2>
        <p className="mt-2">{t.contactIntro}</p>
        <ul className="mt-3 space-y-1 rounded-xl border border-slate-200 bg-white p-4">
          <li>{t.contactName}</li>
          <li>{t.contactPhone}</li>
          <li>{t.contactEmail}</li>
        </ul>
        <p className="mt-3">{t.contactNote}</p>

        <p className="mt-8 text-sm text-slate-500">{t.updated}</p>
      </main>
      <PublicFooter />
    </>
  );
}
