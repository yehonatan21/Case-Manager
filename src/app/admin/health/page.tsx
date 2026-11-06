import { redirect } from "next/navigation";

/** System health moved into Settings; old links keep working. */
export default function HealthPage() {
  redirect("/admin/settings?tab=health");
}
