"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** The confirmation: type the account's email address, then delete. */
function ConfirmDelete({ open, onClose, email, label, onConfirm }: { open: boolean; onClose: () => void; email: string; label: string; onConfirm: (confirm: string) => Promise<void> }) {
  const { d } = useI18n();
  const t = d.accountDeletion;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = value.trim().toLowerCase() === email.toLowerCase();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(value.trim());
    } catch (e) {
      setError(errorText(e, d));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.confirmTitle}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {d.common.cancel}
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!matches}>
            <Trash2 className="size-4" aria-hidden />
            {t.confirmButton}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-700">{t.intro}</p>
      <Field label={label} hint={<span dir="ltr">{email}</span>} error={error}>
        {(p) => (
          <Input
            {...p}
            type="email"
            dir="ltr"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && matches && !busy && void submit()}
          />
        )}
      </Field>
    </Dialog>
  );
}

/** What deleting erases and keeps, and the button (the client's own account). */
export function DeleteAccountCard({ email, preview, className }: { email: string; preview: { cases: number; paidCases: number; openCases: number }; className?: string }) {
  const { d } = useI18n();
  const t = d.accountDeletion;
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="delete-account-title" className={className ?? "rounded-xl border border-red-200 bg-card p-5"} data-delete-account>
      <h2 id="delete-account-title" className="text-base font-semibold text-slate-900">
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{t.intro}</p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <h3 className="font-medium text-slate-900">{t.erasedTitle}</h3>
          <p className="mt-0.5 text-slate-700">{t.erased}</p>
        </div>
        <div>
          <h3 className="font-medium text-slate-900">{t.keptTitle}</h3>
          <p className="mt-0.5 text-slate-700">{t.kept}</p>
        </div>
      </div>
      {preview.cases > 0 && <p className="mt-3 text-sm text-slate-700">{fmt(t.counts, { cases: preview.cases, paid: preview.paidCases })}</p>}
      {preview.openCases > 0 && <p className="mt-1 text-sm font-medium text-amber-800">{fmt(t.openWarning, { n: preview.openCases })}</p>}
      <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden />
        {t.open}
      </Button>
      <ConfirmDelete
        open={open}
        onClose={() => setOpen(false)}
        email={email}
        label={t.confirmLabel}
        onConfirm={async (confirm) => {
          const { next } = await api<{ next: string }>("/api/account/delete", { body: { confirm } });
          window.location.assign(next);
        }}
      />
    </section>
  );
}

/** For admins, on a client's page: delete the account at the client's request. */
export function AdminDeleteClient({ customerId, email }: { customerId: string; email: string }) {
  const { d } = useI18n();
  const t = d.accountDeletion;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="admin-delete-title" className="mt-6 rounded-xl border border-red-200 bg-card p-5">
      <h2 id="admin-delete-title" className="text-base font-semibold text-slate-900">
        {t.title}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{t.adminHint}</p>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden />
        {t.adminButton}
      </Button>
      <ConfirmDelete
        open={open}
        onClose={() => setOpen(false)}
        email={email}
        label={t.adminConfirmLabel}
        onConfirm={async (confirm) => {
          await api(`/api/admin/customers/${customerId}/delete`, { body: { confirm } });
          setOpen(false);
          toast("success", t.adminDone);
          router.push("/admin/customers");
          router.refresh();
        }}
      />
    </section>
  );
}
