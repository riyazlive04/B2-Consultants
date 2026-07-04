import { Clock } from "lucide-react";

/** Gated stub shown until a section's phase is built. Proves RBAC end-to-end in Phase 0. */
export function PhasePlaceholder({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <div className="mt-6 flex flex-col items-center rounded-card border border-line bg-surface p-8 text-center shadow-card">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Clock size={22} />
        </span>
        <p className="font-display text-lg font-semibold">Arrives in Phase {phase}</p>
        <p className="mt-2 max-w-md text-sm text-muted">
          The data model and access rules for this section are already in place. Entry forms and
          dashboards ship when Phase {phase} is approved.
        </p>
      </div>
    </div>
  );
}
