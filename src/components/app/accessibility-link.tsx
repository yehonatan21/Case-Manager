import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/** Link to the accessibility statement, required on every part of the site (IS 5568 / Israeli regulations). */
export async function AccessibilityLink({ className }: { className?: string }) {
  const { d } = await getDict();
  return (
    <Link href="/accessibility" className={cn("text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline", className)}>
      {d.home.accessibility}
    </Link>
  );
}
