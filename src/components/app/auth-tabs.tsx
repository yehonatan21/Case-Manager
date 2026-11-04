"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { TabList, TabPanel } from "@/components/ui/tabs";

/** Sign in and Register on one page; the URL keeps the chosen tab so links and refreshes land on it. */
export function AuthTabs({ initialTab, login, register }: { initialTab: "login" | "register"; login: React.ReactNode; register: React.ReactNode }) {
  const { d } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const change = (t: string) => {
    const next = t === "register" ? "register" : "login";
    setTab(next);
    const url = new URL(window.location.href);
    url.pathname = next === "register" ? "/register" : "/login";
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div className="mt-6">
      <TabList
        label={d.login.authTitle}
        value={tab}
        onChange={change}
        className="grid grid-cols-2"
        tabs={[
          { id: "login", label: d.nav.login },
          { id: "register", label: d.nav.register },
        ]}
      />
      <TabPanel id="login" active={tab === "login"} className="mx-auto max-w-md">
        {login}
      </TabPanel>
      <TabPanel id="register" active={tab === "register"}>
        {register}
      </TabPanel>
    </div>
  );
}
