import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { requirePageStaff } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getSystemHealth } from "@/lib/services/health";
import { PageHeader } from "@/components/ui/misc";
import { HealthView } from "@/components/admin/health/health-view";

export async function generateMetadata() {
  const { d } = await getDict();
  return { title: d.health.title };
}

export default async function HealthPage() {
  const user = await requirePageStaff("/admin/health");
  if (user.role !== "admin") redirect("/admin");
  const { d } = await getDict();
  const h = await getSystemHealth(await getDb(), user);
  return (
    <>
      <PageHeader title={d.health.title} subtitle={d.health.subtitle} />
      <HealthView level={h.level} checks={h.checks} checkedAt={h.checkedAt} />
    </>
  );
}
