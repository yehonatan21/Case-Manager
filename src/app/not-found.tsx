import { getDict } from "@/lib/i18n/server";
import { ButtonLink } from "@/components/ui/button";

export default async function NotFound() {
  const { d } = await getDict();
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-extrabold text-brand-200">404</p>
      <h1 className="mt-4 text-2xl font-bold">{d.states.notFoundTitle}</h1>
      <p className="mt-2 max-w-md text-slate-600">{d.states.notFoundText}</p>
      <ButtonLink href="/" className="mt-6">
        {d.states.goHome}
      </ButtonLink>
    </main>
  );
}
