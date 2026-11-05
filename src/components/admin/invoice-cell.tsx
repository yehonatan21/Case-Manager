"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

/** Payments page: the payment's receipt / invoice, with Issue or Retry for admins and finance. */
export function InvoiceCell({
  paymentId,
  paid,
  invoice,
  canIssue,
}: {
  paymentId: string;
  paid: boolean;
  invoice: { status: "pending" | "issued" | "failed"; number: string | null; url: string | null; documentFileId: string | null; error: string | null } | null;
  canIssue: boolean;
}) {
  const { d } = useI18n();
  const t = d.invoices;
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!paid) return <span className="text-slate-400">{t.none}</span>;

  const issue = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: string; error: string | null }>(`/api/admin/payments/${paymentId}/invoice`, { body: {} });
      if (r.status === "issued") toast("success", t.issued);
      else toast("error", r.error ?? t.failed);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  if (invoice?.status === "issued") {
    // The saved PDF, else the service's own link (only an https one).
    const href = invoice.documentFileId ? `/api/files/${invoice.documentFileId}` : invoice.url?.startsWith("https://") ? invoice.url : null;
    return href ? (
      <a href={href} className="font-medium text-brand-700 hover:underline" target={invoice.documentFileId ? undefined : "_blank"} rel="noopener">
        {invoice.number}
      </a>
    ) : (
      <span>{invoice.number}</span>
    );
  }
  if (invoice?.status === "pending") return <Badge tone="muted">{t.pending}</Badge>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {invoice?.status === "failed" && (
        <Badge tone="danger" title={invoice.error ?? undefined}>
          {t.failed}
        </Badge>
      )}
      {canIssue && (
        <Button size="sm" variant="outline" loading={busy} onClick={issue}>
          {invoice ? t.retry : t.issue}
        </Button>
      )}
    </span>
  );
}
