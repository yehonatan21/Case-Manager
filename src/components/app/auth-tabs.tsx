"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * Sign in and Register on one page. A link under each form switches to the other one,
 * and the URL follows (/login ⇄ /register) so refreshes and shared links land on the same form.
 */
export function AuthTabs({
  initialTab,
  login,
  register,
  top,
  loginExtras,
}: {
  initialTab: "login" | "register";
  login: React.ReactNode;
  register: React.ReactNode;
  /** Notices and the Google button, shown between the heading and the form. */
  top?: React.ReactNode;
  /** Shown below the "Register" link on the sign-in form (staff hint, demo accounts). */
  loginExtras?: React.ReactNode;
}) {
  const { d } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const show = (next: "login" | "register") => {
    setTab(next);
    const url = new URL(window.location.href);
    url.pathname = next === "register" ? "/register" : "/login";
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const switchLink = (text: string, label: string, to: "login" | "register") => (
    <p className="mt-4 text-center text-sm text-slate-600">
      {text}{" "}
      <button type="button" onClick={() => show(to)} className="font-semibold text-brand-700 hover:underline">
        {label}
      </button>
    </p>
  );
  return (
    <div aria-live="polite">
      <h1 className="text-2xl font-bold">{tab === "register" ? d.register.pageTitle : d.login.title}</h1>
      <p className="mb-2 mt-1 text-slate-600">{tab === "register" ? d.register.subtitle : d.login.subtitle}</p>
      {top}
      {tab === "login" ? (
        <div className="mx-auto max-w-md">
          {login}
          {switchLink(d.register.noAccount, d.register.createLink, "register")}
          {loginExtras}
        </div>
      ) : (
        <div>
          {register}
          {switchLink(d.register.haveAccount, d.register.signIn, "login")}
        </div>
      )}
    </div>
  );
}
