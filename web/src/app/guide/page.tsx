import Link from "next/link";
import { BookOpen, ExternalLink } from "lucide-react";

export const metadata = { title: "Guide — career-ops" };

// The operating manual for this install. Static by design: no data read, so it
// can never be stale about the user's pipeline — only about the product, which
// is what the loop below is for.

const LOOP = [
  { step: "Portals", note: "qué mirar" },
  { step: "Today: Explore / Fresh", note: "lo nuevo" },
  { step: "Pipeline → Inbox", note: "triar, gratis" },
  { step: "Evaluar", note: "gasta tokens" },
  { step: "Aplicar", note: "a mano" },
  { step: "Follow-up", note: "lo que trae entrevistas" },
];

const PAGES = [
  {
    href: "/portals",
    name: "Portals",
    what: "Todos los boards que escanea, incluidos los de Argentina (Bumeran/ZonaJobs, Computrabajo, EmpleosIT, GetOnBoard).",
    when: "Cuando “no hay nada nuevo”.",
  },
  {
    href: "/explore",
    name: "Explore",
    what: "La lista completa de avisos nuevos sin triar. Es la sección “Fresh matches this week” de Today, abierta entera.",
    when: "1–2 veces por semana, cuando Today tiene novedades.",
  },
  {
    href: "/pipeline",
    name: "Pipeline → Inbox",
    what: "La misma cola, en lista, con Save / ✓ / X. Los filtros de arriba son gratis.",
    when: "Cuando querés bajar el volumen.",
  },
  {
    href: "/",
    name: "Today",
    what: "Lo que necesita una decisión hoy: avisos nuevos (Explore / Fresh), evaluados sin decidir y follow-ups urgentes.",
    when: "Todos los días, 5 minutos.",
  },
  {
    href: "/pipeline",
    name: "Pipeline → Tracker",
    what: "El registro de todo. Es tu fuente de verdad: si no está acá, no existe.",
    when: "Cuando buscás algo.",
  },
  {
    href: "/followups",
    name: "Follow-ups",
    what: "A quién hay que escribirle y desde cuándo esperás respuesta.",
    when: "Lo que más rinde de todo.",
  },
];

const ACTIONS = [
  { key: "Save", cost: "$0", what: "Manda el aviso al shortlist. No evalúa nada." },
  { key: "✓", cost: "$0", what: "Marca applied: escribe la fila en el tracker y saca el aviso del inbox." },
  { key: "X", cost: "$0", what: "Skip: oculta el aviso. Reversible con “restore”." },
  { key: "Score shortlist", cost: "tokens", what: "Evalúa los guardados, todos juntos, en una sola tanda." },
];

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <BookOpen className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Guide</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Cómo se usa career-ops, de punta a punta. El sistema es un embudo: lo caro (evaluar) va al final, y
        solo sobre lo que ya elegiste vos.
      </p>

      {/* Reference to the upstream manual. Static, external, and above the loop:
          this page documents THIS install, the docs site documents the product
          (scripts, modes, CLI) — different readers, so they are separate links. */}
      <a
        href="https://career-ops.org/es/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/40 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand"
      >
        <BookOpen className="size-3.5" />
        Documentación oficial de career-ops
        <ExternalLink className="size-3" />
      </a>

      {/* the loop */}
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">El loop</h2>
        <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOOP.map(({ step, note }, i) => (
            <li key={step} className="rounded-xl border border-border bg-surface/40 px-3 py-2.5">
              <p className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                <span className="text-[11px] font-semibold tabular-nums text-faint">{i + 1}</span>
                <span>{step}</span>
              </p>
              <p className="mt-0.5 pl-5 text-[11px] text-faint">{note}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-faint">
          Se recorre en ese orden, y cada paso filtra al anterior. Nada llega a “Evaluar” sin haber pasado por tu
          ojo y por el shortlist.
        </p>
      </section>

      {/* pages */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Las páginas</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-surface/60 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Página</th>
                <th className="px-3 py-2 font-semibold">Qué es</th>
                <th className="px-3 py-2 font-semibold">Cuándo entrás</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PAGES.map(({ href, name, what, when }) => (
                <tr key={`${href}-${name}`} className="align-top hover:bg-surface-hover">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Link href={href} className="font-medium text-foreground hover:text-brand hover:underline">
                      {name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted">{what}</td>
                  <td className="px-3 py-3 text-muted">{when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {/* the mental rule */}
      <section className="mt-8">
        <blockquote className="rounded-xl border-l-2 border-brand bg-brand-soft/40 px-4 py-3">
          <p className="font-display text-lg leading-snug text-foreground">
            El inbox no es una lista de tareas, es una laguna.
          </p>
          <p className="mt-1 text-sm text-muted">No se vacía. Se saca lo bueno y se sigue.</p>
        </blockquote>
      </section>

      {/* inbox actions */}
      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Los botones del inbox</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-surface/60 text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Botón</th>
                <th className="px-3 py-2 font-semibold">Costo</th>
                <th className="px-3 py-2 font-semibold">Qué hace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ACTIONS.map(({ key, cost, what }) => (
                <tr key={key} className="align-top">
                  <td className="px-3 py-3 whitespace-nowrap font-medium text-foreground">{key}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${cost === "$0" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {cost}
                  </td>
                  <td className="px-3 py-3 text-muted">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {/* a session */}
      <section className="mt-10 border-t border-border pt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Una sesión de 30 minutos</h2>
        <ol className="mt-4 space-y-3 text-sm">
          {[
            ["Follow-ups — 20 min", "Los vencidos primero. Un seguimiento convierte más que veinte evaluaciones nuevas."],
            ["Today — 5 min", "Decidí lo que está esperando: Review para aplicar, Skip para descartar."],
            ["Inbox — 10 min", "Veinte filas, no ciento cincuenta. Guardá 3–5 y recién ahí “Score shortlist”."],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted">
                {i + 1}
              </span>
              <span>
                <span className="font-medium text-foreground">{title}</span>
                <span className="block text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-sm text-muted">
          Y una regla que no conviene romper: <span className="text-foreground">por debajo de 4.0/5, no se aplica.</span>{" "}
          El score mide el encaje con ese aviso, no tu nivel — un 2.8 aplicado es tiempo que no vas a recuperar.
        </p>
      </section>
    </div>
  );
}
