"use client";

// The "My data" tab: facts a job search needs that never belong on a CV.
//
// Everything here is stored in config/profile.yml (the file every mode reads
// ALWAYS), so a value saved here is immediately in scope for evaluations, cover
// letters and application answers — no second integration, no parallel store.
// The parts that look like over-engineering are the ones the contract demands:
// salary and EEO answers are recorded for the agent's CONTEXT but are still
// never auto-filled into a form (web/src/lib/apply/answer-prompt.mjs refuses
// them, the extension leaves them unticked), and the save path is the surgical
// writer that keeps this hand-written YAML's comments alive.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { FIELDS, ageFrom } from "@/lib/core/my-data-spec.mjs";

type Lang = { language: string; level: string };

type FieldSpec = {
  path: string;
  label: string;
  hint?: string;
  kind: "text" | "date" | "int" | "enum" | "bool" | "multiline";
  options?: string[];
  /** Preset answers for a free-text field: pick instead of typing. */
  choices?: string[];
  /** Show "Other…" + a text box for the cases the preset list cannot guess. */
  allowCustom?: boolean;
  placeholder?: string;
};

// YAML values stay terse and machine-friendly; the control speaks to a human.
const OPTION_LABELS: Record<string, string> = {
  remote: "remote — fully remote",
  hybrid: "hybrid — some office days",
  onsite: "onsite — office full time",
  flexible: "flexible — depends on the role",
  any: "any — no preference at all",
  no: "no",
  maybe: "maybe, for the right role",
  yes: "yes",
};

// CEFR, plus the one level CEFR does not have: native/bilingual. Stored as the
// code ("C1") so the YAML stays terse and comparable, shown as the sentence a
// recruiter recognises.
const LANGUAGE_LEVELS = [
  { code: "Native", label: "Native / bilingual" },
  { code: "C2", label: "C2 — Mastery / proficiency" },
  { code: "C1", label: "C1 — Advanced / effective operational proficiency" },
  { code: "B2", label: "B2 — Upper-intermediate" },
  { code: "B1", label: "B1 — Intermediate" },
  { code: "A2", label: "A2 — Elementary" },
  { code: "A1", label: "A1 — Beginner" },
];

// Labels and hints only. The field LIST lives in lib/core/my-data.mjs (FIELDS):
// the writer validates and serializes from it, so a field added there without a
// label still renders here (falling back to its key) instead of vanishing from
// the form while the server keeps accepting it.
const META: Record<string, Omit<FieldSpec, "path" | "kind">> = {
  "personal.birth_date": {
    label: "Date of birth",
    hint: "Not on the CV. Used for age gates, eligibility cut-offs and forms that ask.",
    placeholder: "YYYY-MM-DD",
  },
  "personal.nationality": { label: "Nationality", hint: "Matters for work authorization and visa questions." },
  "personal.pronouns": {
    label: "Pronouns",
    choices: ["he/him", "she/her", "they/them", "he/they", "she/they", "any"],
    allowCustom: true,
    placeholder: "el/ella, elle…",
  },
  "personal.document_id": {
    label: "Document / DNI / passport",
    hint: "Typed only into a form you review and approve — never into anything sent by itself.",
  },
  "personal.gender": {
    label: "Gender",
    choices: ["Woman", "Man", "Non-binary", "Prefer not to say"],
    allowCustom: true,
  },
  "personal.disability": {
    label: "Disability status",
    choices: ["No", "Yes", "Prefer not to say"],
    allowCustom: true,
  },
  "personal.veteran": {
    label: "Veteran status",
    choices: ["No", "Yes", "Prefer not to say"],
    allowCustom: true,
  },
  "personal.notes": {
    label: "Anything else worth knowing",
    hint: "Constraints, context, reasons behind a gap, what you refuse to do. Free-form — the agent reads it as background, never as a CV claim.",
  },
  "availability.earliest_start": {
    label: "Earliest start",
    choices: [
      "Immediately",
      "2 weeks after offer",
      "1 month after offer",
      "2 months after offer",
      "3 months after offer",
    ],
    allowCustom: true,
    placeholder: "2026-11-01, or anything specific",
  },
  "availability.notice_period_days": { label: "Notice period (days)", placeholder: "0" },
  "availability.work_mode": { label: "Work mode preference", hint: "What you would choose if it were up to you." },
  "availability.accepts_any_work_mode": {
    label: "I accept any work mode",
    hint: "Keeps the preference above a preference, not a filter: office-only or hybrid roles are then a preference not met, never a mismatch to discard.",
  },
  "availability.relocate": { label: "Willing to relocate", options: ["no", "maybe", "yes"] },
  "availability.relocate_to": { label: "Relocate where", placeholder: "anywhere in LATAM / EU only / Madrid…" },
  "availability.travel_percent": { label: "Travel appetite", placeholder: "0%, up to 10%, one week per quarter…" },
  "compensation.target_range": { label: "Target salary", placeholder: "$3,800 USD gross/month" },
  "compensation.minimum": { label: "Walk-away floor", placeholder: "$3,200 USD gross/month" },
  "compensation.currency": { label: "Currency", placeholder: "USD" },
  "compensation.target_range_local": { label: "Target, local currency", placeholder: "~$4,500,000 ARS gross/month" },
  "compensation.location_flexibility": { label: "Location / flexibility note" },
};

const GROUPS: { title: string; note?: string; paths: string[]; eeo?: boolean }[] = [
  {
    title: "Personal",
    note: "Facts that are not (and should not be) CV lines, but that forms ask for over and over.",
    paths: [
      "personal.birth_date",
      "personal.nationality",
      "personal.pronouns",
      "personal.document_id",
      "personal.notes",
    ],
  },
  {
    title: "Availability",
    note: "What you can say yes to, and when. Used to judge offers and to answer availability questions.",
    paths: [
      "availability.earliest_start",
      "availability.notice_period_days",
      "availability.work_mode",
      "availability.accepts_any_work_mode",
      "availability.relocate",
      "availability.relocate_to",
      "availability.travel_percent",
    ],
  },
  {
    title: "Compensation",
    note: "Context for judging offers and anchoring negotiation. Salary questions on application forms are ALWAYS left for you to answer — a stored figure never becomes an auto-filled one.",
    paths: [
      "compensation.target_range",
      "compensation.minimum",
      "compensation.currency",
      "compensation.target_range_local",
      "compensation.location_flexibility",
    ],
  },
  {
    title: "Self-identification (optional)",
    note: "EEO answers some US/LATAM forms request. Stored so you never have to look them up, and never written into a form automatically.",
    paths: ["personal.gender", "personal.disability", "personal.veteran"],
    eeo: true,
  },
];

const SPECS: FieldSpec[] = FIELDS.map((f: { path: string; kind: string; options?: string[] }) => ({
  path: f.path,
  kind: f.kind as FieldSpec["kind"],
  options: f.options,
  ...(META[f.path] ?? { label: f.path.split(".")[1] }),
}));

const specOf = (path: string) => SPECS.find((s) => s.path === path);

export function MyDataForm() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // A preset list cannot guess every answer ("el/ella", a start date). "Other…"
  // opens a text box instead of writing the choice into the YAML: the stored
  // value stays the human's own words, never a sentinel.
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/my-data")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setValues(d.values ?? {});
        setLanguages(d.languages ?? []);
      })
      .catch(() => setError("Could not read config/profile.yml"))
      .finally(() => setLoaded(true));
  }, []);

  const age = useMemo(() => ageFrom(values["personal.birth_date"] || ""), [values]);

  function set(path: string, value: string) {
    setValues((prev) => ({ ...prev, [path]: value }));
    setDirty(true);
    setSaved(false);
  }

  function setLang(i: number, patch: Partial<Lang>) {
    setLanguages((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/my-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { ...values, languages } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `save failed (${res.status})`);
      setValues(data.values ?? values);
      setLanguages(data.languages ?? languages);
      setCustomOpen({});
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">My data</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            What a job search needs to know about you that a CV never says. Saved to{" "}
            <code className="text-foreground">config/profile.yml</code>, which every evaluation and draft
            already reads — so it is context, not a file you have to re-explain.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
            dirty ? "bg-brand text-brand-foreground hover:bg-brand-200" : "border border-border bg-surface text-muted",
          )}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-6 space-y-4">
        {GROUPS.map((group) => (
          <section key={group.title} className="rounded-2xl border border-border bg-surface/50 p-5">
            <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
            {group.note && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-faint">{group.note}</p>}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {group.paths.map((path) => {
                const spec = specOf(path);
                if (!spec) return null;
                if (spec.kind === "multiline") {
                  return (
                    <Field key={path} spec={spec} className="sm:col-span-2">
                      <textarea
                        value={values[path] ?? ""}
                        onChange={(e) => set(path, e.target.value)}
                        rows={4}
                        placeholder={spec.placeholder}
                        className={inputClass}
                      />
                    </Field>
                  );
                }
                if (spec.kind === "bool") {
                  return (
                    <label
                      key={path}
                      className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface/40 px-3 py-2.5 sm:col-span-2"
                    >
                      <input
                        type="checkbox"
                        checked={values[path] === "true"}
                        onChange={(e) => set(path, e.target.checked ? "true" : "false")}
                        className="mt-0.5 size-4 shrink-0 accent-brand"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{spec.label}</span>
                        {spec.hint && (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-faint">{spec.hint}</span>
                        )}
                      </span>
                    </label>
                  );
                }
                if (spec.kind === "enum") {
                  return (
                    <Field key={path} spec={spec}>
                      <select
                        value={values[path] ?? ""}
                        onChange={(e) => set(path, e.target.value)}
                        className={inputClass}
                      >
                        <option value="">— not set —</option>
                        {(spec.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {OPTION_LABELS[o] ?? o}
                          </option>
                        ))}
                      </select>
                    </Field>
                  );
                }
                if (spec.choices?.length) {
                  return (
                    <Field key={path} spec={spec}>
                      <ChoiceInput
                        spec={spec}
                        value={values[path] ?? ""}
                        open={!!customOpen[path]}
                        onChange={(v) => set(path, v)}
                        onOpenOther={() => {
                          setCustomOpen((prev) => ({ ...prev, [path]: true }));
                          set(path, "");
                        }}
                      />
                    </Field>
                  );
                }
                return (
                  <Field key={path} spec={spec}>
                    <input
                      type={spec.kind === "date" ? "date" : spec.kind === "int" ? "number" : "text"}
                      min={spec.kind === "int" ? 0 : undefined}
                      value={values[path] ?? ""}
                      onChange={(e) => set(path, e.target.value)}
                      placeholder={spec.placeholder}
                      className={inputClass}
                    />
                    {path === "personal.birth_date" && age !== null && (
                      <p className="mt-1 text-[11px] text-faint">You are {age} today.</p>
                    )}
                  </Field>
                );
              })}
            </div>
          </section>
        ))}

        <section className="rounded-2xl border border-border bg-surface/50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Languages</h2>
              <p className="mt-1 text-xs text-faint">
                CEFR levels, plus native/bilingual. Pick the level you could defend in an interview — forms
                asking &ldquo;Spanish — fluent?&rdquo; then get a consistent, honest answer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLanguages((prev) => [...prev, { language: "", level: "" }]);
                setDirty(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground max-sm:min-h-[44px]"
            >
              <Plus className="size-3.5" /> Add
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {languages.length === 0 && <p className="text-xs text-faint">None listed yet.</p>}
            {languages.map((lang, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={lang.language}
                  onChange={(e) => setLang(i, { language: e.target.value })}
                  placeholder="Spanish"
                  className={cn(inputClass, "flex-1 min-w-[8rem]")}
                />
                <select
                  value={lang.level}
                  onChange={(e) => setLang(i, { level: e.target.value })}
                  className={cn(inputClass, "w-56")}
                >
                  <option value="">— level —</option>
                  {LANGUAGE_LEVELS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                  {/* A level saved before this list existed must not vanish. */}
                  {lang.level && !LANGUAGE_LEVELS.some((l) => l.code === lang.level) && (
                    <option value={lang.level}>{lang.level}</option>
                  )}
                </select>
                <button
                  type="button"
                  aria-label="Remove language"
                  onClick={() => {
                    setLanguages((prev) => prev.filter((_, idx) => idx !== i));
                    setDirty(true);
                  }}
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-faint transition-colors hover:text-red-500 max-sm:min-h-[44px] max-sm:min-w-[44px]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-faint">
        A save backs up the previous <code>config/profile.yml</code> and rewrites only the lines this tab owns —
        comments and sections you wrote by hand stay exactly where they are. Empty a field and save to remove a
        fact you no longer want on record.
      </p>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40";

/**
 * A free-text field with preset answers. The stored value is still free text —
 * the preset list is an input convenience, not a schema change — so an existing
 * hand-written value is shown as-is and "Other…" reveals a text box.
 */
function ChoiceInput({
  spec,
  value,
  open,
  onChange,
  onOpenOther,
}: {
  spec: FieldSpec;
  value: string;
  open: boolean;
  onChange: (v: string) => void;
  onOpenOther: () => void;
}) {
  const choices = spec.choices ?? [];
  const options = value && !choices.includes(value) ? [...choices, value] : choices;
  return (
    <>
      <select
        value={open ? "__other" : value}
        onChange={(e) => {
          if (e.target.value === "__other") onOpenOther();
          else onChange(e.target.value);
        }}
        className={inputClass}
      >
        <option value="">— not set —</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        {spec.allowCustom && <option value="__other">Other…</option>}
      </select>
      {open && (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.placeholder}
          className={cn(inputClass, "mt-2")}
        />
      )}
    </>
  );
}

function Field({
  spec,
  children,
  className,
}: {
  spec: FieldSpec;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-muted">{spec.label}</span>
      {children}
      {spec.hint && <span className="mt-1 block text-[11px] leading-relaxed text-faint">{spec.hint}</span>}
    </label>
  );
}
