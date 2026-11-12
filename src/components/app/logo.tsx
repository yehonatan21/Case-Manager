import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ href = "/", className, name, compact = false }: { href?: string; className?: string; name: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 font-bold text-slate-900", className)}>
      <span aria-hidden className="flex size-8 items-center justify-center rounded-[0.6rem] bg-accent text-white">
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M4 12h10M4 17h7" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </span>
      <span className={compact ? "sr-only" : "whitespace-nowrap text-[0.9375rem] tracking-tight max-[359px]:sr-only"}>{name}</span>
    </Link>
  );
}
