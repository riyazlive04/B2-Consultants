import Link from "next/link";
import { Workflow } from "lucide-react";
import { PIPELINE_MODE_EFFECT, STAGE_RULES } from "@/lib/stage-rules";
import { Card, CardTitle, Pill } from "@/components/ui/kit";

/**
 * "What moves a card without me touching it?"
 *
 * ── Why this is here ────────────────────────────────────────────────────────────
 * "Automatic move mode" was reported as missing. It never was: a call outcome closes a lead, a
 * booking advances one, a discovery outcome routes one, and every lead-stage change moves its
 * card. All of it real, all of it enforced - and all of it spread across five modules with
 * nothing on any screen saying it happens. From the board, a card that moved by itself was
 * indistinguishable from a card someone else had dragged.
 *
 * A closed disclosure, not a banner: this is the answer to a question people ask once, and it
 * should not cost the board vertical space every day.
 *
 * The list is `lib/stage-rules.ts`, which names the enforcing module for each rule - so this
 * cannot quietly become a lie without someone editing a rule and not the list.
 */
export function StageRulesCard({
  mode,
  canConfigure,
}: {
  mode: "rules" | "drag_drop";
  canConfigure: boolean;
}) {
  const automatic = STAGE_RULES.filter((r) => r.automatic);
  const manual = STAGE_RULES.filter((r) => !r.automatic);

  return (
    <Card
      title={<CardTitle icon={<Workflow size={18} />}>How cards move</CardTitle>}
      actions={
        <Pill tone={mode === "rules" ? "info" : "neutral"}>
          {mode === "rules" ? "Rules-driven" : "Drag and drop"}
        </Pill>
      }
    >
      <p className="text-sm text-muted">{PIPELINE_MODE_EFFECT[mode]}</p>
      {canConfigure && (
        <p className="mt-1 text-caption text-ink-3">
          Change this at{" "}
          <Link href="/console" className="font-semibold text-accent underline">
            Console → Sales ops → Operations
          </Link>
          .
        </p>
      )}

      <details className="group mt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
          <span className="group-open:hidden">Show the {automatic.length} automatic rules</span>
          <span className="hidden group-open:inline">Hide the rules</span>
        </summary>

        <ul className="mt-3 space-y-2">
          {automatic.map((r) => (
            <li key={r.trigger} className="rounded-field border border-line bg-surface-2 p-3">
              <p className="text-sm text-ink">
                <span className="font-medium">{r.trigger}</span>
                <span className="mx-1.5 text-ink-3">→</span>
                {r.result}
              </p>
              <p className="mt-0.5 font-mono text-caption text-ink-3">{r.enforcedIn}</p>
            </li>
          ))}
        </ul>

        {manual.length > 0 && (
          <>
            <p className="mt-4 text-caption font-semibold uppercase tracking-wide text-ink-3">
              Not automatic - a person decides
            </p>
            <ul className="mt-2 space-y-2">
              {manual.map((r) => (
                <li key={r.trigger} className="rounded-field border border-dashed border-line p-3">
                  <p className="text-sm text-ink">
                    <span className="font-medium">{r.trigger}</span>
                    <span className="mx-1.5 text-ink-3">→</span>
                    {r.result}
                  </p>
                  <p className="mt-0.5 font-mono text-caption text-ink-3">{r.enforcedIn}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </Card>
  );
}
