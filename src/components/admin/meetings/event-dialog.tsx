"use client";

import { TimeInput } from "@/components/ui/time-input";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Video } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { EditableEvent } from "@/lib/calendar-view";

/** The Meetings page calendar: a team member's own events — the "New event" button, and each event opens to edit. */

type Form = Omit<EditableEvent, "id" | "notes"> & { notes: string };

function EventForm({ initial, id, google, onDone }: { initial: Form; id: string | null; google: boolean; onDone: () => void }) {
  const { d } = useI18n();
  const t = d.meetings.cal;
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const valid = f.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && (f.allDay || (f.startTime && f.endTime && f.endTime > f.startTime));

  const save = async () => {
    setBusy("save");
    try {
      const body = {
        title: f.title.trim(),
        notes: f.notes.trim() || null,
        date: f.date,
        allDay: f.allDay,
        ...(f.allDay ? {} : { startTime: f.startTime, endTime: f.endTime }),
        video: google && f.video,
      };
      const r = await api<{ google: boolean }>(id ? `/api/admin/events/${id}` : "/api/admin/events", { method: id ? "PUT" : "POST", body });
      toast("success", `${id ? t.eventSaved : t.eventCreated}${r.google ? ` ${t.eventInGoogle}` : ""}`);
      onDone();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!id || !window.confirm(t.eventDeleteConfirm)) return;
    setBusy("delete");
    try {
      await api(`/api/admin/events/${id}`, { method: "DELETE" });
      toast("success", t.eventDeleted);
      onDone();
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <Field label={t.eventTitle} required>
        {(p) => <Input {...p} autoFocus maxLength={200} value={f.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label={t.eventDate} required>
        {(p) => <DateInput {...p} value={f.date} onChange={(date) => set({ date })} />}
      </Field>
      <Checkbox label={t.allDay} checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
      {!f.allDay && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t.eventStart} required>
            {(p) => <TimeInput {...p} step={5} value={f.startTime} onChange={(startTime) => set({ startTime })} />}
          </Field>
          <Field label={t.eventEnd} required>
            {(p) => <TimeInput {...p} step={5} value={f.endTime} onChange={(endTime) => set({ endTime })} />}
          </Field>
        </div>
      )}
      <Field label={t.eventNotes}>{(p) => <Textarea {...p} rows={3} maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />}</Field>
      {google ? <Checkbox label={t.eventVideo} checked={f.video} onChange={(e) => set({ video: e.target.checked })} /> : <p className="text-sm text-slate-600">{t.eventNoGoogle}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <Button type="submit" loading={busy === "save"} disabled={!valid}>
          {id ? t.eventSave : t.eventCreate}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {d.common.cancel}
        </Button>
        {id && (
          <Button type="button" variant="ghost" className="ms-auto text-red-700" loading={busy === "delete"} onClick={remove}>
            <Trash2 className="size-4" aria-hidden /> {t.eventDelete}
          </Button>
        )}
      </div>
    </form>
  );
}

const roundedHour = () => {
  const h = Math.min(22, new Date().getHours() + 1);
  return [`${String(h).padStart(2, "0")}:00`, `${String(h + 1).padStart(2, "0")}:00`] as const;
};

/** "New event", on the day shown (or today). */
export function NewEventButton({ date, google, initialOpen = false }: { date: string; google: boolean; initialOpen?: boolean }) {
  const { d } = useI18n();
  const t = d.meetings.cal;
  const [open, setOpen] = useState(initialOpen);
  // "?new=event" (from Quick Create) opens the form once; drop it so a reload doesn't open it again.
  useEffect(() => {
    if (!initialOpen) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url.toString());
  }, [initialOpen]);
  const [start, end] = roundedHour();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {t.newEvent}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.newEvent}>
        {open && (
          <EventForm
            id={null}
            google={google}
            onDone={() => setOpen(false)}
            initial={{
              title: "",
              notes: "",
              date,
              allDay: false,
              startTime: start,
              endTime: end,
              video: false,
            }}
          />
        )}
      </Dialog>
    </>
  );
}

/** One of the team member's own events in the calendar: opens to edit. */
export function EventChip({
  event,
  label,
  time,
  className,
  style,
  compact,
  google,
}: {
  event: EditableEvent;
  label: string;
  time: string;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
  google: boolean;
}) {
  const { d } = useI18n();
  const t = d.meetings.cal;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("block w-full overflow-hidden rounded-md border border-sky-400 bg-sky-50 px-1.5 py-0.5 text-start text-xs leading-tight text-sky-950 hover:bg-sky-100 bidi-auto", className)}
        style={style}
      >
        <span className={cn("block truncate font-medium", compact && "inline")}>
          {event.video && <Video className="me-1 inline size-3" aria-hidden />}
          {label}
        </span>
        {!compact && <span className="block truncate text-[11px] opacity-90">{time}</span>}
        <span className="sr-only">
          {compact ? `, ${time}` : ""} ({t.legendEvent}, {t.eventEditHint})
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.editEvent}>
        {open && <EventForm id={event.id} google={google} onDone={() => setOpen(false)} initial={{ ...event, notes: event.notes ?? "" }} />}
      </Dialog>
    </>
  );
}
