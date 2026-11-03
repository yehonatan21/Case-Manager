import { getDict } from "@/lib/i18n/server";
import { StartRequest } from "@/components/intake/start-request";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.nav.newRequest };
}

export default async function NewRequestPage() {
  const { d } = await getDict();
  return (
    <div className="mx-auto max-w-2xl py-4">
      <h1 className="text-3xl font-bold tracking-tight">{d.home.title}</h1>
      <p className="mt-2 text-slate-600">{d.home.subtitle}</p>
      <div className="mt-6">
        <StartRequest />
      </div>
    </div>
  );
}
