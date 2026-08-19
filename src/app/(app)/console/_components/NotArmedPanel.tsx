"use client";

import { AlertTriangle, CheckCircle2, Server } from "lucide-react";
import type { NotArmedItem } from "@/server/not-armed";
import { Card, Hint } from "./kit";

/**
 * Console → System → Not armed.
 *
 * ── Why this screen is worth a tab ──────────────────────────────────────────────
 * This app ships nearly everything OFF, which is right for anything that spends money or
 * messages a customer - and it had no single place that said so. The result was a set of
 * "bugs" that were all the same non-bug: availability was never configured, so the booking
 * calendar was empty and both specialist desks had nothing on them; email was never armed, so
 * password resets and dunning silently did nothing.
 *
 * A feature that is built, off, and unmentioned is indistinguishable from a feature that is
 * broken. This is the list that tells them apart.
 *
 * Every row names the CONSEQUENCE before the fix, because the consequence is what makes someone
 * act. "Slot pattern: disabled" is a status light; "no prospect can book a call" is a decision.
 */
export function NotArmedPanel({ items }: { items: NotArmedItem[] }) {
  const off = items.filter((i) => !i.armed);
  const on = items.filter((i) => i.armed);

  return (
    <div className="space-y-5">
      <Hint>
        Everything on this list is <strong>built and working</strong>. The only question is
        whether it is switched on. Anything in the top section is currently doing nothing -
        which is usually what &ldquo;that section looks broken&rdquo; turns out to mean.
      </Hint>

      {off.length === 0 ? (
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold text-good">
            <CheckCircle2 size={16} /> Everything is armed. Nothing is silently switched off.
          </p>
        </Card>
      ) : (
        <Card title={`Not armed (${off.length})`} subtitle="Built, switched off, and doing nothing right now.">
          <ul className="space-y-3">
            {off.map((i) => (
              <li key={i.key} className="rounded-field border border-warn bg-warn-soft p-3.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-warn-ink">
                  <AlertTriangle size={15} className="flex-none" />
                  {i.name}
                  {i.needsDeploy && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-caption font-semibold text-ink-3">
                      <Server size={11} /> needs a deploy
                    </span>
                  )}
                </p>
                <p className="mt-1 text-caption text-warn-ink">{i.consequence}</p>
                <p className="mt-1.5 text-caption font-medium text-ink-2">→ {i.where}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {on.length > 0 && (
        <Card title={`Armed (${on.length})`} subtitle="Switched on and running.">
          <ul className="space-y-1.5">
            {on.map((i) => (
              <li key={i.key} className="flex items-center gap-2 text-sm text-ink-2">
                <CheckCircle2 size={14} className="flex-none text-good" />
                {i.name}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
