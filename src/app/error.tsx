"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";
import { reportBrowserError } from "@/components/app/error-reporter";
import { Button, ButtonLink } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { d } = useI18n();
  // Errors in server-rendered pages are recorded on the server already (their digest is all the browser gets).
  useEffect(() => {
    if (!error.digest) reportBrowserError(error);
  }, [error]);
  return (
    <main id="main" className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">{d.states.errorTitle}</h1>
      <p className="mt-2 max-w-md text-slate-600">{d.states.errorText}</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>{d.common.retry}</Button>
        <ButtonLink href="/" variant="outline">
          {d.states.goHome}
        </ButtonLink>
      </div>
    </main>
  );
}
