import { getDict } from "@/lib/i18n/server";
import { AuthPage, type AuthSearchParams } from "@/components/app/auth-page";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.register.pageTitle };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  return <AuthPage tab="register" sp={await searchParams} />;
}
