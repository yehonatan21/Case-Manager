"use client";

import { useEffect } from "react";

/** Opens the app once on load (the browser may ask first); the button stays for when it doesn't. */
export function OpenAppLink({ href, label }: { href: string; label: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.assign(href), 300);
    return () => clearTimeout(t);
  }, [href]);
  return (
    <a href={href} className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-6 text-base font-semibold text-white hover:bg-accent-strong">
      {label}
    </a>
  );
}
