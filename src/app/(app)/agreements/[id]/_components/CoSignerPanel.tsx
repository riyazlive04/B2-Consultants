"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Loader2, UserPlus, UserX, XCircle } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { PhoneField } from "@/components/ui/PhoneField";
import { askConfirm, toast } from "@/components/ui/feedback";
import { addAgreementSigner, removeAgreementSigner } from "@/server/agreement-actions";

/**
 * The co-signer on an agreement: a parent or guardian signing for a student under 18, or a witness.
 *
 * ── WHAT THIS PANEL HAS TO MAKE OBVIOUS ─────────────────────────────────────────────────────
 * Two things, because getting either wrong wastes a round trip with a client:
 *
 *   1. A co-signer can only be added while the agreement is a DRAFT. Their link is minted when
 *      the founder countersigns, so somebody added afterwards would never be sent one - and the
 *      student's own ceremony would then wait forever on a person who was never asked.
 *
 *   2. They sign BEFORE the student. That is not a preference, it is what keeps the student's
 *      signature as the thing that seals the document (see server/agreement-signers.ts), and it
 *      means a guardian who never gets round to it blocks the whole agreement.
 */

export type CoSignerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  declineReason: string | null;
};

export function CoSignerPanel({
  agreementId,
  signers,
  isDraft,
  /** The document asks a guardian to sign something, so one is REQUIRED for it to complete. */
  required,
}: {
  agreementId: string;
  signers: CoSignerRow[];
  isDraft: boolean;
  required: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Nothing to say at all: no co-signer, none needed, and no way to add one.
  if (signers.length === 0 && !required && !isDraft) return null;

  const add = () => {
    setError(null);
    startTransition(async () => {
      const res = await addAgreementSigner({ agreementId, name, phone, email });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdding(false);
      setName("");
      setPhone("");
      setEmail("");
      toast("Co-signer added. They are sent their own link when you countersign.");
      router.refresh();
    });
  };

  const remove = (signer: CoSignerRow) => {
    startTransition(async () => {
      const ok = await askConfirm({
        title: `Remove ${signer.name}?`,
        body: "They will not be asked to co-sign. If the document has guardian fields on it, it cannot be sent until somebody is added back.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      const res = await removeAgreementSigner(signer.id);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Co-signer removed.");
      router.refresh();
    });
  };

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-1 font-display text-h2 font-semibold">Co-signer</h2>
      <p className="mb-4 text-xs text-muted">
        {required
          ? "This document has fields for a parent, guardian or witness - it cannot be sent until one is invited, and the student cannot sign until they have."
          : "A parent, guardian or witness who signs before the student. Optional unless the document has fields for one."}
      </p>

      {signers.length > 0 && (
        <ul className="mb-4 space-y-2">
          {signers.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-surface-2 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate text-xs text-muted">
                  {s.phone}
                  {s.email ? ` · ${s.email}` : ""}
                </p>
                {s.declinedAt && s.declineReason && (
                  <p className="mt-1 text-xs text-risk">“{s.declineReason}”</p>
                )}
              </div>
              <div className="flex flex-none items-center gap-2">
                <Status signer={s} />
                {isDraft && (
                  <Btn
                    variant="ghost"
                    size="sm"
                    icon={<UserX size={14} />}
                    disabled={pending}
                    onClick={() => remove(s)}
                  >
                    Remove
                  </Btn>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <FormError message={error} />

      {!isDraft ? (
        signers.length === 0 && (
          <p className="text-xs text-muted">
            No co-signer was invited, and one cannot be added now that the agreement has been issued.
            Void and clone it if the document needs one.
          </p>
        )
      ) : adding ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <TextInput
                kind="name"
                value={name}
                placeholder="Rukmini Raghunathan"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="WhatsApp number"
              required
              hint="The one-time code goes here - this is how we know it is them."
            >
              {/* Uncontrolled by design - PhoneField owns the dial-code picker and reports the
                  normalised E.164 through onChange. */}
              <PhoneField onChange={setPhone} />
            </Field>
          </div>
          <Field label="Email" hint="Optional, but it is the second route to them if WhatsApp fails.">
            <TextInput
              kind="email"
              value={email}
              placeholder="parent@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              icon={pending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              onClick={add}
              disabled={pending}
              busy={pending}
            >
              Add co-signer
            </Btn>
            <Btn variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        signers.length === 0 && (
          <Btn variant="secondary" icon={<UserPlus size={15} />} onClick={() => setAdding(true)}>
            Invite a co-signer
          </Btn>
        )
      )}
    </div>
  );
}

/** Signed, declined, or still waiting - the three states that matter to the founder. */
function Status({ signer }: { signer: CoSignerRow }) {
  if (signer.signedAt) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok">
        <CheckCircle2 size={13} /> Signed
      </span>
    );
  }
  if (signer.declinedAt) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-risk-soft px-2.5 py-1 text-xs font-semibold text-risk">
        <XCircle size={13} /> Declined
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
      <Clock size={13} /> Waiting
    </span>
  );
}
