import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getDict } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/client";
import { ToastProvider } from "@/components/ui/toast";
import { env } from "@/lib/env";
import { WebAnalytics } from "@/components/app/web-analytics";
import { ErrorReporter } from "@/components/app/error-reporter";
import { CategoriesProvider } from "@/components/app/categories";
import { getDb } from "@/lib/db";
import { listServiceCategories } from "@/lib/services/categories";
import { aiMayKeepData } from "@/lib/ai/providers";
import { NativeBridge } from "@/components/native/native-bridge";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getDict();
  return {
    title: { default: d.meta.title, template: `%s · ${d.common.appName}` },
    description: d.meta.description,
    // Home-screen app on iPhone (required there for push notifications).
    appleWebApp: { capable: true, title: d.common.appName, statusBarStyle: "default" },
    // No `icons` here: setting it replaces the icons Next.js generates from the files in src/app
    // (icon.svg = browser-tab icon, apple-icon.png = iPhone home screen). Change those files instead.
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getDict();
  // Service types for labels and pickers everywhere (custom ones live in the database).
  const categories = await listServiceCategories(await getDb()).catch(() => []);
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-[100] rounded-md bg-card px-3 py-2 text-sm font-medium text-brand-800 shadow focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
          {d.nav.skipToContent}
        </a>
        {env.demoMode && (
          <div role="note" className="bg-[#fbbf24] px-4 py-1.5 text-center text-xs font-semibold text-[#451a03]">
            {d.common.demoBanner}
          </div>
        )}
        <I18nProvider locale={locale} aiMayKeepData={aiMayKeepData()}>
          <CategoriesProvider categories={categories}>
            <ToastProvider>{children}</ToastProvider>
            <NativeBridge />
          </CategoriesProvider>
        </I18nProvider>
        <ErrorReporter />
        {env.isVercel && <WebAnalytics />}
      </body>
    </html>
  );
}
