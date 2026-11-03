"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export function LogoutButton({ className, withLabel = true }: { className?: string; withLabel?: boolean }) {
  const { d } = useI18n();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
      className={cn("inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100", className)}
      aria-label={d.nav.logout}
    >
      <LogOut className="size-4 flip-rtl" aria-hidden />
      {withLabel && <span>{d.nav.logout}</span>}
    </button>
  );
}
