import { getCurrentUser } from "@/lib/auth/session";
import { getDict } from "@/lib/i18n/server";
import { isStaffRole } from "@/lib/domain";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { ButtonLink } from "@/components/ui/button";

export async function PublicHeader() {
  const [{ d }, user] = await Promise.all([getDict(), getCurrentUser()]);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo name={d.common.appName} />
        <nav aria-label={d.nav.accountMenu} className="flex items-center gap-2">
          <LanguageSwitcher />
          {user ? (
            <ButtonLink href={isStaffRole(user.role) ? "/admin" : "/portal"} variant="outline" size="md">
              {isStaffRole(user.role) ? d.nav.staffArea : d.nav.clientArea}
            </ButtonLink>
          ) : (
            <ButtonLink href="/login" variant="outline" size="md">
              {d.nav.myAccount}
            </ButtonLink>
          )}
        </nav>
      </div>
    </header>
  );
}

export async function PublicFooter() {
  const { d } = await getDict();
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500">
        <p>
          © {new Date().getFullYear()} {d.common.appName}. {d.home.footer}
        </p>
        <nav aria-label={d.nav.footerMenu} className="flex flex-wrap gap-x-4 gap-y-2">
          <a href="/accessibility" className="hover:text-slate-800">
            {d.home.accessibility}
          </a>
          <a href="/privacy" className="hover:text-slate-800">
            {d.home.privacy}
          </a>
          <a href="/terms" className="hover:text-slate-800">
            {d.home.terms}
          </a>
          <a href="/delete-account" className="hover:text-slate-800">
            {d.accountDeletion.pageTitle}
          </a>
          <a href="/login?next=/admin" className="hover:text-slate-800">
            {d.home.staffLogin}
          </a>
        </nav>
      </div>
    </footer>
  );
}
