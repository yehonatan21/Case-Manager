import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-slate-500", className)}>
      <span className="size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800", className)}>
      {initials(name)}
    </span>
  );
}

const noticeTones = {
  info: { cls: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  danger: { cls: "border-red-200 bg-red-50 text-red-900", Icon: XCircle },
};

export function Notice({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: keyof typeof noticeTones;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { cls, Icon } = noticeTones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "leading-relaxed")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action, className }: { icon?: React.ReactNode; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-card px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 text-slate-500">{icon}</div>}
      <p className="font-semibold text-slate-800">{title}</p>
      {text && <p className="mt-1 max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[1.875rem] font-bold leading-tight text-slate-900 sm:text-[2.125rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-[0.9375rem] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="size-2 animate-dot rounded-full bg-brand-500" style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  );
}
