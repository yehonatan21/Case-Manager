import Link from "next/link";
import { cn } from "@/lib/utils";

/** The logo's square mark on its own. */
export function LogoMark() {
  return (
    <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-accent-gradient text-white shadow-sm">
      <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16M4 12h10M4 17h7" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/", className, name, compact = false }: { href?: string; className?: string; name: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 text-slate-900", className)}>
      <LogoMark />
      <span className={compact ? "sr-only" : "whitespace-nowrap font-display text-[1.0625rem] font-bold leading-none tracking-tight sm:text-[1.1875rem] max-[379px]:sr-only"}>{name}</span>
    </Link>
  );
}
