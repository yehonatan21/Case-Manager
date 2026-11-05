"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Eraser, PenLine } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

/**
 * Optional drawn signature: pointer input (mouse, touch, stylus) on a canvas. Drawing is never required — the
 * typed name is the signature — so keyboard and screen reader users can sign without it.
 */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { d } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const hintId = useId();

  // Match the drawing buffer to the canvas's displayed size (it's 0×0 until the dialog is laid out).
  const fit = () => {
    const c = canvas.current;
    if (!c || c.offsetWidth === 0) return false;
    const ratio = window.devicePixelRatio || 1;
    const w = Math.round(c.offsetWidth * ratio);
    const h = Math.round(c.offsetHeight * ratio);
    if (c.width === w && c.height === h) return true;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e1b4b";
    // Resizing clears the drawing.
    setHasInk(false);
    onChange(null);
    return true;
  };
  useEffect(() => {
    const c = canvas.current!;
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!fit()) return;
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const url = canvas.current!.toDataURL("image/png");
    if (!url.startsWith("data:image/png;base64,")) return;
    setHasInk(true);
    onChange(url);
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div>
      <p className="text-sm font-medium text-slate-800">{d.signatures.drawLabel}</p>
      <p id={hintId} className="mb-1.5 text-xs text-slate-500">
        {d.signatures.drawHint}
      </p>
      <canvas
        ref={canvas}
        role="img"
        aria-label={hasInk ? d.signatures.drawn : d.signatures.drawCanvas}
        aria-describedby={hintId}
        className="h-32 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-slate-50"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="mt-1 flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={!hasInk}>
          <Eraser className="size-4" aria-hidden /> {d.signatures.clear}
        </Button>
      </div>
    </div>
  );
}

/** The signature fields shared by document signing and quote approval: full name, optional drawing. */
export function SignatureFields({ name, setName, setImage }: { name: string; setName: (s: string) => void; setImage: (s: string | null) => void }) {
  const { d } = useI18n();
  return (
    <div className="grid gap-4">
      <Field label={d.signatures.nameLabel} hint={d.signatures.nameHint} required>
        {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <SignaturePad onChange={setImage} />
    </div>
  );
}

export const nameLooksValid = (n: string) => {
  const t = n.replace(/\s+/g, " ").trim();
  return t.length >= 2 && t.length <= 120 && (t.match(/\p{L}/gu) ?? []).length >= 2;
};

/** Client: review a document and sign it. */
export function SignDialog({
  open,
  onClose,
  signatureId,
  title,
  fileId,
  note,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  signatureId: string;
  title: string;
  fileId: string;
  note: string | null;
  defaultName: string;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);

  const sign = async () => {
    setBusy(true);
    try {
      await api(`/api/signatures/${signatureId}/sign`, { body: { name, image, consent } });
      toast("success", d.signatures.signedToast);
      onClose();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={fmt(d.signatures.dialogTitle, { title })}
      className="w-[min(100%-2rem,36rem)]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {d.common.cancel}
          </Button>
          <Button onClick={sign} loading={busy} disabled={!consent || !nameLooksValid(name)}>
            <PenLine className="size-4" aria-hidden /> {d.signatures.submit}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <section aria-labelledby="sig-step1" className="grid gap-2">
          <h3 id="sig-step1" className="text-sm font-semibold">
            {d.signatures.step1}
          </h3>
          {note && <Notice tone="info">{note}</Notice>}
          <a
            href={`/api/files/${fileId}?inline=1`}
            target="_blank"
            rel="noopener"
            onClick={() => setOpened(true)}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="size-4" aria-hidden />
            {d.signatures.openDocument}
            <span className="sr-only"> ({d.signatures.opensInNewTab})</span>
          </a>
        </section>
        <section aria-labelledby="sig-step2" className="grid gap-4">
          <h3 id="sig-step2" className="text-sm font-semibold">
            {d.signatures.step2}
          </h3>
          <SignatureFields name={name} setName={setName} setImage={setImage} />
          <Checkbox label={d.signatures.consent} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {!opened && <p className="text-xs text-slate-500">{d.signatures.readFirst}</p>}
        </section>
      </div>
    </Dialog>
  );
}
