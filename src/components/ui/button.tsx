import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "link" | "signal";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:bg-brand-300 aria-disabled:bg-brand-300",
  secondary: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  outline: "border border-slate-200 bg-card text-slate-800 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-danger text-white hover:bg-danger-strong disabled:bg-red-300 aria-disabled:bg-red-300",
  link: "text-brand-700 underline-offset-4 hover:underline px-0",
  // What the client has to do now (the next step): terracotta, white text 5.6:1.
  signal: "bg-signal text-white hover:bg-signal/90",
};
const sizes: Record<Size, string> = {
  // 44 px on phones (accessibility.md: 44x44 pt default on iOS), a little tighter with a pointer.
  sm: "h-9 px-3.5 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2 sm:h-10",
  lg: "h-12 px-6 text-base gap-2",
  icon: "size-11 justify-center sm:size-10",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-xl font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 aria-disabled:cursor-wait aria-disabled:opacity-70 whitespace-nowrap",
    variants[variant],
    sizes[size],
    className,
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant, size, className, loading, children, disabled, type = "button", onClick, ...props }, ref) {
  // While loading the button stays focusable (aria-disabled instead of disabled), so keyboard and screen-reader
  // users keep their place when a form is submitted (WCAG 2.4.3); clicks and Enter-submits are ignored meanwhile.
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      // Only buttons with a loading state (always in client components) get the guard; server-rendered
      // buttons must not receive an event handler.
      onClick={
        loading === undefined
          ? onClick
          : (e) => {
              if (loading) {
                e.preventDefault();
                return;
              }
              onClick?.(e);
            }
      }
      {...props}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
