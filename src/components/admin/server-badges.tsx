import { Badge, type Tone } from "@/components/ui/badge";

const TONES: Record<string, Tone> = { low: "muted", normal: "neutral", high: "warning", urgent: "danger" };

export function UrgencyBadgeServer({ urgency, label }: { urgency: string; label: string }) {
  return <Badge tone={TONES[urgency] ?? "neutral"}>{label}</Badge>;
}
