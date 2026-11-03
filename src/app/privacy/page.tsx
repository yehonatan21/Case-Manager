import { getDict } from "@/lib/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/app/public-header";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.legal.privacyTitle };
}

export default async function PrivacyPage() {
  const { d } = await getDict();
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold">{d.legal.privacyTitle}</h1>
        <ul className="mt-6 space-y-4 leading-relaxed text-slate-700">
          {d.legal.privacy.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </main>
      <PublicFooter />
    </>
  );
}
