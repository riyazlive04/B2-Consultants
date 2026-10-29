"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { DEFAULT_IMPROVEMENTS, type ImprovementsConfig } from "@/lib/config-schema";
import { saveImprovementsConfig } from "@/server/maintenance-actions";
import { Card, Hint, SaveBar, TextIn, Toggle } from "./kit";

/**
 * Founder Console → System → Improvements.
 *
 * ── There is no switch for the Report button, and that is deliberate ────────────────────────
 * Every engine in this app ships OFF, which is right for anything that spends money or messages
 * a customer. It would be wrong here: the Report button writes one row and sends nothing outside
 * the organisation, so shipping it disarmed would reproduce the exact problem this module exists
 * to surface - a built feature nobody can tell is switched off.
 *
 * What this panel controls is the NOTIFICATION, which does leave the building.
 *
 * Blank address is a working setup, not a broken one: the queue still fills and the bell still
 * counts, nobody is emailed. The panel says so rather than leaving someone to wonder.
 */
export function ImprovementsPanel({
  config,
  emailArmed,
}: {
  config: ImprovementsConfig;
  emailArmed: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ImprovementsConfig>(config);
  const [saved, setSaved] = useState<ImprovementsConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await saveImprovementsConfig(draft);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Couldn't save");
    setSaved(draft);
    toast("Improvement notifications saved");
    router.refresh();
  }

  return (
    <Card>
      <h4 className="text-h3 text-ink">Improvements</h4>
      <Hint>
        Anyone can file one from the <strong>Suggest an improvement</strong> button in the top bar -
        every role, every screen. They land in <code>/improvements</code> with the screen, the person&apos;s
        role, the running build and whether the engine behind that screen was switched on.
        <br />
        There is no on/off switch for filing itself. This is only about who gets emailed.
      </Hint>

      {!emailArmed && (
        <p className="mt-3 rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
          Email is not armed, so nothing below can send. The queue and the in-app count work
          regardless.
        </p>
      )}

      <div className="mt-4 max-w-md space-y-4">
        <Field
          label="Developer's email"
          hint="Leave this blank for in-app only. Nothing is sent and nothing breaks."
        >
          <TextIn
            value={draft.developerEmail}
            onChange={(developerEmail) => setDraft({ ...draft, developerEmail })}
            placeholder="dev@example.com"
            ariaLabel="Developer's email address"
          />
        </Field>

        <Toggle
          checked={draft.emailOnBlocking}
          onChange={(emailOnBlocking) => setDraft({ ...draft, emailOnBlocking })}
          label="Email immediately when somebody is blocked"
        />
        <Hint>
          Only for &ldquo;I can&apos;t do my job&rdquo;. Severity is the reporter&apos;s own
          answer and it decides nothing else - not the order work is done in, which stays yours.
        </Hint>

        <Toggle
          checked={draft.dailyDigest}
          onChange={(dailyDigest) => setDraft({ ...draft, dailyDigest })}
          label="One daily summary of everything else"
        />
        <Hint>
          Rides the existing daily tick, and sends nothing on a day with nothing new. A report
          that already triggered its own email is never repeated here.
        </Hint>
      </div>

      <SaveBar
        dirty={dirty}
        onSave={commit}
        onReset={() => setDraft(DEFAULT_IMPROVEMENTS)}
        busy={busy}
        error={error}
      />
    </Card>
  );
}
