"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Info, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { api, errorText } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/misc";
import { useCategories } from "@/components/app/categories";
import type { IntakeSummary } from "@/lib/db/schema";
import { AccountStep } from "./account-step";
import { fmt } from "@/lib/i18n/config";

type Props = {
  intakeId: string | null;
  summary: IntakeSummary;
  mode: "review" | "manual";
  user: { name: string; isStaff: boolean } | null;
  googleEnabled?: boolean;
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function RequestReview({ intakeId, summary, mode, user, googleEnabled }: Props) {
  const { d } = useI18n();
  const categories = useCategories();
  const router = useRouter();
  const [title, setTitle] = useState(summary.request_title);
  const [goal, setGoal] = useState(summary.customer_goal);
  const [description, setDescription] = useState(summary.request_description);
  const [facts, setFacts] = useState(summary.known_facts.length ? summary.known_facts : []);
  const [constraints, setConstraints] = useState(summary.constraints.join("\n"));
  const [missing, setMissing] = useState(summary.missing_information.join("\n"));
  const [category, setCategory] = useState(summary.service_category || "other");
  const [urgency, setUrgency] = useState(summary.urgency);
  const [notes, setNotes] = useState(summary.additional_notes ?? "");
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [stage, setStage] = useState<"edit" | "account">("edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = () => {
    const e: typeof errors = {};
    if (!title.trim()) e.title = d.review.titleRequired;
    if (!description.trim()) e.description = d.review.descriptionRequired;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitCase = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let id = intakeId;
      if (!id) id = (await api<{ id: string }>("/api/intake", { body: { mode: "manual" } })).id;
      const res = await api<{ id: string; number: string }>("/api/cases", {
        body: {
          intakeId: id,
          edits: {
            request_title: title,
            request_description: description,
            customer_goal: goal,
            service_category: category,
            urgency,
            known_facts: facts.filter((f) => f.label.trim() || f.value.trim()),
            constraints: lines(constraints),
            missing_information: lines(missing),
            additional_notes: notes || undefined,
          },
        },
      });
      router.push(`/portal/cases/${res.id}?submitted=1`);
    } catch (e) {
      setError(errorText(e, d));
      setSubmitting(false);
    }
  };

  const onPrimary = () => {
    if (!validate()) return;
    if (user) void submitCase();
    else setStage("account");
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{mode === "manual" ? d.review.manualTitle : d.review.title}</h1>
      <p className="mt-2 text-slate-600">{mode === "manual" ? d.review.manualSubtitle : d.review.subtitle}</p>

      <Card className="mt-6">
        <CardContent className="space-y-5 py-6">
          <Field label={d.review.requestTitle} required error={errors.title}>
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="bidi-auto" disabled={stage === "account"} />}
          </Field>
          <Field label={d.review.goal}>
            {(p) => <Input {...p} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} className="bidi-auto" disabled={stage === "account"} />}
          </Field>
          <Field label={d.review.description} required error={errors.description}>
            {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={8000} className="bidi-auto" disabled={stage === "account"} />}
          </Field>

          <fieldset disabled={stage === "account"}>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">{d.review.knownFacts}</legend>
            <div className="space-y-2">
              {facts.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={d.review.factLabel} placeholder={d.review.factLabel} value={f.label} className="bidi-auto w-2/5" onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input aria-label={d.review.factValue} placeholder={d.review.factValue} value={f.value} className="bidi-auto flex-1" onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <Button variant="ghost" size="icon" aria-label={d.common.remove} onClick={() => setFacts(facts.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button variant="link" size="sm" onClick={() => setFacts([...facts, { label: "", value: "" }])}>
                <Plus className="size-4" /> {d.review.addFact}
              </Button>
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={d.review.constraints} hint={d.review.constraintsHint}>
              {(p) => <Textarea {...p} value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={3} className="bidi-auto" disabled={stage === "account"} />}
            </Field>
            <Field label={d.review.missingInfo} hint={d.review.missingInfoHint}>
              {(p) => <Textarea {...p} value={missing} onChange={(e) => setMissing(e.target.value)} rows={3} className="bidi-auto" disabled={stage === "account"} />}
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={d.review.category}>
              {(p) => (
                <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)} disabled={stage === "account"}>
                  {!categories.list.some((x) => x.key === category) && <option value={category}>{categories.label(category)}</option>}
                  {categories.list.map((c) => (
                    <option key={c.key} value={c.key}>
                      {categories.label(c.key)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={d.review.urgency}>
              {(p) => (
                <Select {...p} value={urgency} onChange={(e) => setUrgency(e.target.value as IntakeSummary["urgency"])} disabled={stage === "account"}>
                  {(["low", "normal", "high", "urgent"] as const).map((u) => (
                    <option key={u} value={u}>
                      {d.urgency[u]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label={d.review.notes}>
            {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={d.review.notesPlaceholder} className="bidi-auto" disabled={stage === "account"} />}
          </Field>

          {summary.assumptions.length > 0 && (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="mb-1 font-medium text-slate-700">{d.review.assumptions}</p>
              <ul className="list-inside list-disc space-y-0.5">
                {summary.assumptions.map((a, i) => (
                  <li key={i} className="bidi-auto">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Notice tone="info">
            <span className="inline-flex items-start gap-1">
              <Info className="sr-only" />
              {d.review.preliminary}
            </span>
          </Notice>
        </CardContent>
      </Card>

      {error && (
        <Notice tone="danger" className="mt-4">
          {error}
        </Notice>
      )}

      {stage === "edit" ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          {intakeId && mode === "review" ? (
            <Link href={`/intake/${intakeId}`} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              {d.review.backToChat}
            </Link>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-slate-500">{fmt(d.account.loggedInAs, { name: user.name })}</span>}
            <Button size="lg" onClick={onPrimary} loading={submitting} disabled={user?.isStaff}>
              {submitting ? d.review.submitting : d.review.submit}
              {!submitting && <ArrowRight className="size-4 flip-rtl" aria-hidden />}
            </Button>
          </div>
        </div>
      ) : (
        <AccountStep
          onBack={() => setStage("edit")}
          onVerified={submitCase}
          submitting={submitting}
          // Google returns to this page signed in; the reviewed request is kept in the intake session.
          google={googleEnabled && !!intakeId}
          googleNext={intakeId ? `/intake/${intakeId}/review` : undefined}
        />
      )}
    </div>
  );
}
