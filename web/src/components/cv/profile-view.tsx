"use client";

// /cv → "Profile": the read-only answer to "what does the system actually know
// about me?" — the CV's own sections, the FULL credential inventory (the CV is a
// deliberate subset), and the facts that never go on a CV.
//
// Read-only by design. Two write surfaces already exist and stay authoritative:
// the CV tab edits cv.md, the My data tab edits config/profile.yml. A third
// editor here would be a second way to write the same fact — exactly what
// web/AGENTS.md rule 2 forbids.

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { certificationSummary, formatCertDate } from "@/lib/cv/profile-facts.mjs";

type Section = { heading: string; body: string; key?: string };
type Cert = {
  n: number;
  title: string;
  issuer: string;
  date: string;
  dateApproximate: boolean;
  credential: string;
  verifyUrl: string | null;
  onCv: boolean;
};
type Payload = {
  cv: { exists: boolean; sections: Section[] };
  certifications: { exists: boolean; rows: Cert[]; error?: string };
  myData: { exists: boolean; values: Record<string, string>; languages: { language: string; level: string }[]; error?: string };
};

const MY_DATA_ROWS: { label: string; path: string }[] = [
  { label: "Target compensation", path: "compensation.target_range" },
  { label: "Floor", path: "compensation.minimum" },
  { label: "Local reference", path: "compensation.target_range_local" },
  { label: "Work mode", path: "availability.work_mode" },
  { label: "Open to any mode", path: "availability.accepts_any_work_mode" },
  { label: "Relocate", path: "availability.relocate" },
  { label: "Relocate to", path: "availability.relocate_to" },
  { label: "Travel", path: "availability.travel_percent" },
  { label: "Earliest start", path: "availability.earliest_start" },
  { label: "Notice period (days)", path: "availability.notice_period_days" },
];

function Card({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface/40 p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-display text-lg tracking-tight text-landing">{title}</h2>
        {hint && <p className="text-xs text-faint">{hint}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="report-prose text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function ProfileView() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const sections = data?.cv.sections ?? [];
  const certs = data?.certifications.rows ?? [];
  const counts = certificationSummary(certs);

  // Certification rows come from the inventory (richer and complete); the CV's
  // own `## Certifications` block would print the subset a second time.
  const pick = (re: RegExp) => sections.find((s) => re.test(s.heading.trim()));
  const summary = pick(/summary/i);
  const education = pick(/^education$/i);
  const rest = sections.filter(
    (s) => s !== summary && s !== education && !/^certifications$/i.test(s.heading.trim()) && !/^languages$/i.test(s.heading.trim()),
  );

  const myData = data?.myData.values ?? {};
  const languages = data?.myData.languages ?? [];
  const facts = MY_DATA_ROWS.map((r) => ({ label: r.label, value: myData[r.path] ?? "" }))
    // The form stores flags as YAML booleans; "true" on a page about a person reads like a bug.
    .map((r) => ({ ...r, value: r.value === "true" ? "Yes" : r.value === "false" ? "No" : r.value }))
    .filter((r) => r.value);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-landing">Profile</h1>
        <p className="mt-1 text-sm text-muted">
          What the system knows about you. Read-only — edit the CV in the{" "}
          <span className="text-foreground">CV</span> tab, personal facts in{" "}
          <span className="text-foreground">My data</span>.
        </p>
        <p className="mt-1 text-xs text-faint">
          Sources: <code className="text-foreground">cv.md</code> ·{" "}
          <code className="text-foreground">data/certifications.md</code> ·{" "}
          <code className="text-foreground">config/profile.yml</code>
        </p>
      </div>

      {failed && (
        <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Could not read your profile files. Is the career-ops data root reachable?
        </div>
      )}

      {!failed && !data && <div className="mt-6 text-sm text-muted">Loading…</div>}

      {data && (
        <div className="mt-6 space-y-4">
          {!data.cv.exists && (
            <div className="rounded-xl border border-border bg-surface/40 px-4 py-3 text-sm text-muted">
              No <code className="text-foreground">cv.md</code> yet — the CV tab creates it on first save.
            </div>
          )}

          {summary && (
            <Card title={summary.heading}>
              <Markdown>{summary.body}</Markdown>
            </Card>
          )}

          <Card
            title="Certifications"
            hint={
              data.certifications.exists
                ? `${counts.total} credentials · ${counts.onCv} on the CV · ${counts.contextOnly} kept as context`
                : "data/certifications.md not found"
            }
          >
            {data.certifications.error && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Could not read the inventory: {data.certifications.error}
              </p>
            )}
            {!data.certifications.exists && !data.certifications.error && (
              <p className="text-sm text-muted">
                No inventory file yet. Certifications on the CV still appear in the CV tab.
              </p>
            )}
            {counts.total > 0 && (
              <ul className="divide-y divide-border/60">
                {certs.map((c) => (
                  <li key={c.n} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                    <span className="text-sm font-medium text-foreground">{c.title}</span>
                    <span className="text-xs text-muted">
                      {c.issuer} · {formatCertDate(c.date)}
                      {c.dateApproximate && (
                        <span
                          title="The certificate does not print a date — this is the PDF's creation date."
                          className="cursor-help"
                        >
                          {" "}
                          ¹
                        </span>
                      )}
                    </span>
                    {c.verifyUrl ? (
                      <a
                        href={c.verifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand-text hover:underline"
                      >
                        verify ↗
                      </a>
                    ) : (
                      <code className="text-xs text-faint">{c.credential}</code>
                    )}
                    <span
                      className={cn(
                        "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium",
                        c.onCv
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-surface-hover text-muted",
                      )}
                    >
                      {c.onCv ? "on CV" : "context only"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {education && (
            <Card title={education.heading}>
              {/* Education in cv.md is a bold title line followed by the institution
                  line. Markdown collapses that single newline into a space, which
                  reads as one run-on line — so each source line gets its own block. */}
              <div className="space-y-1">
                {education.body
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((line, i) => (
                    <Markdown key={i}>{line}</Markdown>
                  ))}
              </div>
            </Card>
          )}

          {rest.map((s) => (
            <Card key={s.key ?? s.heading} title={s.heading}>
              <Markdown>{s.body}</Markdown>
            </Card>
          ))}

          {(facts.length > 0 || languages.length > 0) && (
            <Card title="My data" hint="config/profile.yml — facts that never go on a CV">
              {data.myData.error && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Could not read profile.yml: {data.myData.error}
                </p>
              )}
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-[11px] uppercase tracking-wide text-faint">{f.label}</dt>
                    <dd className="text-sm text-foreground">{f.value}</dd>
                  </div>
                ))}
                {languages.length > 0 && (
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-faint">Languages</dt>
                    <dd className="text-sm text-foreground">
                      {languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(" · ")}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
