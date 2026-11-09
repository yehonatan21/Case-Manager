"use client";

import { TimeInput } from "@/components/ui/time-input";
import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarPlus, Download, Phone, Video, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime, TIME_ZONE } from "@/lib/i18n/format";
import { api, errorText } from "@/lib/client-api";
import { zonedDay, zonedToUtc } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type MeetingItem = {
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  mode: "video" | "phone" | "office";
  status: "scheduled" | "cancelled";
  notes: string | null;
  staffId: string;
  staffName: string;
  meetUrl: string | null;
  location: string | null;
  cancelReason: string | null;
};
type Slot = { start: string; end: string; staffId: string; staffName: string };
const MODE_ICON = { video: Video, phone: Phone, office: Building2 } as const;

/**
 * Meetings of a case. Clients book in the free slots of the team member handling the case; staff pick any date
 * and time (Israel time) for themselves or a colleague. Both can change the time, cancel, and add to a calendar.
 */
export function MeetingsPanel({
  caseId,
  mode,
  meetings,
  durations,
  canBook,
  staff = [],
  currentUserId,
  openBooking = false,
}: {
  caseId: string;
  mode: "client" | "staff";
  meetings: MeetingItem[];
  durations: number[];
  canBook: boolean;
  /** Staff: colleagues a meeting can be booked for. */
  staff?: { id: string; name: string }[];
  currentUserId: string;
  /** Open the booking form straight away (staff, from Quick Create). */
  openBooking?: boolean;
}) {
  const { d, locale } = useI18n();
  const t = d.meetings;
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ kind: "book" } | { kind: "move"; meeting: MeetingItem } | null>(openBooking && canBook ? { kind: "book" } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();
  const upcoming = meetings.filter((m) => m.status === "scheduled" && new Date(m.endAt).getTime() > now).sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt));
  const past = meetings.filter((m) => !upcoming.includes(m));

  const cancel = async (m: MeetingItem) => {
    if (!window.confirm(t.cancelConfirm)) return;
    setBusy(m.id);
    try {
      await api(`/api/meetings/${m.id}`, { method: "DELETE" });
      toast("success", t.cancelled);
      router.refresh();
    } catch (e) {
      toast("error", errorText(e, d));
    } finally {
      setBusy(null);
    }
  };

  const minutes = (m: MeetingItem) => Math.round((+new Date(m.endAt) - +new Date(m.startAt)) / 60000);

  const row = (m: MeetingItem, active: boolean) => {
    const Icon = MODE_ICON[m.mode];
    return (
      <li key={m.id} className={cn("rounded-lg border border-slate-200 bg-white p-4", !active && "opacity-80")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-brand-700" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {formatDateTime(m.startAt, locale)} · {fmt(t.minutes, { n: minutes(m) })}
              </p>
              <p className="text-sm text-slate-600">
                {t.modes[m.mode]} · {fmt(t.with, { name: m.staffName })}
                {m.status === "cancelled" && (
                  <Badge tone="muted" className="ms-2">
                    {t.cancelledBadge}
                  </Badge>
                )}
              </p>
              {m.location && m.mode === "office" && <p className="bidi-auto text-sm text-slate-600">{m.location}</p>}
              {m.notes && <p className="bidi-auto mt-1 text-sm text-slate-600">{m.notes}</p>}
              {m.cancelReason && <p className="bidi-auto mt-1 text-sm text-slate-500">{m.cancelReason}</p>}
            </div>
          </div>
          {active && (
            <div className="flex flex-wrap items-center gap-2">
              {m.mode === "video" && m.meetUrl && (
                <a href={m.meetUrl} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800">
                  <Video className="size-4" aria-hidden /> {t.join}
                  <span className="sr-only"> ({d.signatures.opensInNewTab})</span>
                </a>
              )}
              <a href={`/api/meetings/${m.id}/ics`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Download className="size-4" aria-hidden /> {t.addToCalendar}
              </a>
              {canBook && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "move", meeting: m })}>
                    {t.reschedule}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" loading={busy === m.id} onClick={() => cancel(m)}>
                    {t.cancel}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{t.upcoming}</h2>
        {canBook && (
          <Button onClick={() => setDialog({ kind: "book" })}>
            <CalendarPlus className="size-4" aria-hidden /> {t.book}
          </Button>
        )}
      </div>
      {upcoming.length === 0 ? <EmptyState icon={<CalendarClock className="size-10" />} title={t.none} /> : <ul className="space-y-3">{upcoming.map((m) => row(m, true))}</ul>}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            {t.past} ({past.length})
          </summary>
          <ul className="mt-3 space-y-3">{past.map((m) => row(m, false))}</ul>
        </details>
      )}
      {dialog && (
        <BookDialog
          key={dialog.kind === "move" ? dialog.meeting.id : "book"}
          caseId={caseId}
          mode={mode}
          durations={durations}
          staff={staff}
          currentUserId={currentUserId}
          moving={dialog.kind === "move" ? { id: dialog.meeting.id, minutes: minutes(dialog.meeting), staffId: dialog.meeting.staffId } : null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

const dayLabel = (iso: string, locale: "he" | "en") => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(iso));
const timeLabel = (iso: string, locale: "he" | "en") => new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE }).format(new Date(iso));

function BookDialog({
  caseId,
  mode,
  durations,
  staff,
  currentUserId,
  moving,
  onClose,
}: {
  caseId: string;
  mode: "client" | "staff";
  durations: number[];
  staff: { id: string; name: string }[];
  currentUserId: string;
  moving: { id: string; minutes: number; staffId: string } | null;
  onClose: () => void;
}) {
  const { d, locale } = useI18n();
  const t = d.meetings;
  const router = useRouter();
  const toast = useToast();
  const [duration, setDuration] = useState(moving?.minutes ?? durations[0] ?? 30);
  const [meetMode, setMeetMode] = useState<"video" | "phone" | "office">("video");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [staffId, setStaffId] = useState(moving?.staffId ?? (staff.some((s) => s.id === currentUserId) ? currentUserId : staff[0]?.id ?? ""));
  const tomorrow = zonedDay(new Date(Date.now() + 86_400_000)).day;
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("10:00");
  const [busy, setBusy] = useState(false);

  // Clients choose among free slots; staff type a date and time.
  useEffect(() => {
    if (mode !== "client") return;
    let live = true;
    setSlots(null);
    setPicked("");
    api<Slot[]>(`/api/cases/${caseId}/meetings/slots?duration=${duration}${moving ? `&except=${moving.id}` : ""}`)
      .then((r) => {
        if (!live) return;
        const mine = moving ? r.filter((s) => s.staffId === moving.staffId) : r;
        setSlots(mine);
        setDay(mine[0] ? zonedDay(new Date(mine[0].start)).day : "");
      })
      .catch((e) => {
        if (live) {
          setSlots([]);
          toast("error", errorText(e, d));
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, duration, mode]);

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const k = zonedDay(new Date(s.start)).day;
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return map;
  }, [slots]);
  const daySlots = days.get(day) ?? [];
  const pickedSlot = daySlots.find((s) => `${s.start}|${s.staffId}` === picked);
  const staffStart = mode === "staff" && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? zonedToUtc(date, time) : null;
  const ready = mode === "client" ? !!pickedSlot : !!staffStart && staffStart.getTime() > Date.now() && !!staffId;

  const submit = async () => {
    setBusy(true);
    try {
      const start = mode === "client" ? pickedSlot!.start : staffStart!.toISOString();
      if (moving) {
        await api(`/api/meetings/${moving.id}`, { method: "PATCH", body: { start } });
        toast("success", t.moved);
      } else {
        await api(`/api/cases/${caseId}/meetings`, { body: { start, durationMinutes: duration, mode: meetMode, notes: notes || null, staffId: mode === "client" ? pickedSlot!.staffId : staffId } });
        toast("success", t.booked);
      }
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
      open
      onClose={onClose}
      title={moving ? t.rescheduleTitle : t.bookTitle}
      className="w-[min(100%-2rem,36rem)]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {d.common.cancel}
          </Button>
          <Button onClick={submit} loading={busy} disabled={!ready}>
            {moving ? t.reschedule : t.confirm}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!moving && <p className="text-sm text-slate-600">{t.bookHint}</p>}
        {!moving && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.duration}>
              {(p) => (
                <Select {...p} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {(mode === "client" ? durations : [...new Set([...durations, 15, 45, 90])].sort((a, b) => a - b)).map((n) => (
                    <option key={n} value={n}>
                      {fmt(t.minutes, { n })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.mode}>
              {(p) => (
                <Select {...p} value={meetMode} onChange={(e) => setMeetMode(e.target.value as typeof meetMode)}>
                  {(["video", "phone", "office"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t.modes[m]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}

        {mode === "client" ? (
          slots === null ? (
            <p className="text-sm text-slate-500" role="status">
              {t.loadingSlots}
            </p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-600" role="status">
              {t.noSlots}
            </p>
          ) : (
            <>
              <Field label={t.pickDay}>
                {(p) => (
                  <Select
                    {...p}
                    value={day}
                    onChange={(e) => {
                      setDay(e.target.value);
                      setPicked("");
                    }}
                  >
                    {[...days.keys()].map((k) => (
                      <option key={k} value={k}>
                        {dayLabel(days.get(k)![0]!.start, locale)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-800">{t.pickTime}</legend>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((s) => {
                    const v = `${s.start}|${s.staffId}`;
                    const many = new Set(daySlots.map((x) => x.staffId)).size > 1;
                    return (
                      <label key={v} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600", picked === v ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}>
                        <input type="radio" name="slot" value={v} checked={picked === v} onChange={() => setPicked(v)} className="sr-only" />
                        <span dir="ltr">{timeLabel(s.start, locale)}</span>
                        {many && <span className="ms-1 text-xs opacity-80">· {s.staffName}</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )
        ) : (
          <>
            {!moving && staff.length > 1 && (
              <Field label={t.forWhom}>
                {(p) => (
                  <Select {...p} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.staffDate}>{(p) => <DateInput {...p} min={zonedDay(new Date()).day} value={date} onChange={setDate} />}</Field>
              <Field label={t.staffHour} hint={t.staffTime}>{(p) => <TimeInput {...p} step={5} value={time} onChange={setTime} />}</Field>
            </div>
          </>
        )}

        {!moving && <Field label={t.notes}>{(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>}
      </div>
    </Dialog>
  );
}
