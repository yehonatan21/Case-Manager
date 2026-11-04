import { getDict } from "@/lib/i18n/server";
import { AuthPage, type AuthSearchParams } from "@/components/app/auth-page";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.login.title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<AuthSearchParams> }) {
  return <AuthPage tab="login" sp={await searchParams} />;
}
