"use client";

import { useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { SuggestImprovementModal } from "./SuggestImprovementModal";

/**
 * THE REPORT BUTTON - top bar, every screen, every role.
 *
 * ── Why it is mounted once, in the shell ────────────────────────────────────────────────────
 * `/portal`, `/tutor` and `/coach` are LOGIN screens; every authenticated surface in this app,
 * students included, renders inside the `(app)` group under `AppShell`. So one mount covers all
 * six roles, and there is no second copy to keep in step.
 *
 * ── Why it is not gated on anything ─────────────────────────────────────────────────────────
 * Unlike `RecordButton`, which asks whether the viewer holds Finance, this is offered to
 * everybody. A student or a tutor is the person most likely to hit a dead end and the least
 * likely to have any other way of telling anyone - gating the button is how you silence exactly
 * the reports worth having. Reading the queue is admin-only (`improvements` section); working it needs
 * `improvements.triage`. Filing is for everyone.
 *
 * ── Why not a floating button ───────────────────────────────────────────────────────────────
 * The rail collapses to icons at 1100px and the top bar is already where global actions live
 * (§5.1/§5.4). A floating button would sit over `DataTable` pagination on the money screens,
 * which are the screens people are on when they find a wrong number.
 *
 * ── No keyboard shortcut, deliberately ─────────────────────────────────────────────────────
 * `mod+K` is the command palette and a second global chord is noise. The palette itself is a
 * NAVIGATOR - every item in it is an href - so putting "Suggest an improvement" in there would mean
 * teaching it to run actions, which is a change to its item model for the sake of one entry.
 * The button is on every screen and in the tab order; that is enough.
 */
export function SuggestImprovementButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Suggest an improvement to this screen"
        aria-label="Suggest an improvement to this screen"
        // Quiet by default: this is always available and almost never the thing you came to do,
        // so it reads as a tool rather than a call to action. `text-ink-2` on hover-fill matches
        // the logout and theme controls beside it rather than competing with Record.
        className="press hidden h-10 w-10 flex-none place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink sm:grid"
      >
        <MessageSquareWarning size={18} />
      </button>

      <SuggestImprovementModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
