import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getDict } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/client";
import { ToastProvider } from "@/components/ui/toast";
import { env } from "@/lib/env";
import { WebAnalytics } from "@/components/app/web-analytics";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getDict();
  return {
    title: { default: d.meta.title, template: `%s · ${d.common.appName}` },
    description: d.meta.description,
    // Home-screen app on iPhone (required there for push notifications).
    appleWebApp: { capable: true, title: d.common.appName, statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = { themeColor: "#4338ca", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getDict();
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-[100] rounded-md bg-white px-3 py-2 text-sm font-medium text-brand-800 shadow focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
          {d.nav.skipToContent}
        </a>
        {env.demoMode && (
          <div role="note" className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
            {d.common.demoBanner}
          </div>
        )}
        <I18nProvider locale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
        {env.isVercel && <WebAnalytics />}
      </body>
    </html>
  );
}
