/**
 * What goes IN each placed field, for both uploaded document kinds. Pure and isomorphic.
 *
 * One function so the two renderers cannot disagree about what a field shows. The DOCX renderer
 * typesets these into the text flow; the PDF overlay stamps them at coordinates. If they derived
 * their own values, "signed on 21.10.2026" on a Word agreement and on a PDF agreement would
 * eventually be two different dates.
 *
 * The rule for an UNFILLED field: it renders as an empty ruled box with its caption, never as a
 * placeholder, a dash or the word "pending". The student must be able to see at a glance which
 * boxes are theirs, and a draft preview must never look like an executed document.
 */

import { AGREEMENT_PROVIDER, formatGermanDateOf, type AgreementData } from "./agreement";
import {
  defaultFieldLabel,
  isInkField,
  isSignerFilled,
  type DocField,
  type SignerRole,
  type SignerValues,
} from "./agreement-doc";
import { mergeFieldValue, type MergeContext } from "./agreement-merge";

export type FilledField = {
  field: DocField;
  /** The caption printed under the box. Always present - a box with no label is a trap. */
  caption: string;
  /** PNG data URL, for a SIGNATURE or INITIALS box that has actually been signed. */
  ink?: string | null;
  /** The line of text this box prints: a date, a printed name, a typed value, a filename. */
  text?: string | null;
  /** CHECKBOX only: ticked, not ticked, or (null) not answered because nobody has signed yet. */
  ticked?: boolean | null;
};

export type SignerInk = {
  /** PNG data URL. Absent until that party has signed. */
  ink?: string | null;
  signedAt?: Date | null;
  /** The printed name for a NAME box. */
  name?: string | null;
  /** What this party typed or ticked, by field id. */
  values?: SignerValues | null;
};

export type FillInput = {
  fields: readonly DocField[];
  data: AgreementData;
  ctx: MergeContext;
  /**
   * One entry per signer. A role with no entry has not signed and its boxes render empty, which
   * is exactly what a draft preview must look like.
   */
  signers: Partial<Record<SignerRole, SignerInk>>;
};

/** Resolve every field to what it prints. Keyed by field id, in the order the fields were given. */
export function fillFields(input: FillInput): Map<string, FilledField> {
  const out = new Map<string, FilledField>();

  for (const field of input.fields) {
    const caption = field.label?.trim() || defaultFieldLabel(field.kind, field.signer);
    const signer = input.signers[field.signer];
    const filled: FilledField = { field, caption };

    if (isInkField(field.kind)) {
      filled.ink = signer?.ink ?? null;
      out.set(field.id, filled);
      continue;
    }

    switch (field.kind) {
      case "DATE":
        filled.text = signer?.signedAt ? formatGermanDateOf(signer.signedAt) : null;
        break;

      case "NAME":
        /**
         * A printed name is filled as soon as it is KNOWN, not when its party signs - it is not
         * evidence of anything, it is the typed name beside the ink, and leaving the student's own
         * name blank on the copy they are being asked to read is just confusing.
         */
        filled.text = nameFor(field.signer, input);
        break;

      case "CHECKBOX": {
        /**
         * ONCE THEY HAVE SIGNED, AN UNTOUCHED BOX IS A "NO" - not an "unanswered".
         *
         * The distinction that matters on a contract is not whether the browser sent a `false` or
         * sent nothing: it is whether anybody has been through the ceremony yet. Before a signature
         * exists the box is genuinely unanswered and prints empty, the same as on the draft the
         * student is reading. After one, they saw the box and left it alone, and an optional term
         * they declined is a fact about what was agreed - so it prints as explicitly not ticked.
         *
         * Keying off `signedAt` rather than off the presence of the key also means the printed
         * document cannot depend on a detail of how the ceremony serialises its state.
         */
        const value = signerValue(signer, field.id);
        filled.ticked = value === true ? true : signer?.signedAt ? false : null;
        break;
      }

      case "TEXT":
      case "ATTACHMENT": {
        if (isSignerFilled(field)) {
          const value = signerValue(signer, field.id);
          filled.text = typeof value === "string" && value.trim() ? value : null;
          break;
        }
        // A CREATOR text box: the founder's own typed value, with merge fields resolved.
        filled.text = mergeFieldValue(field.value, input.data, input.ctx) || null;
        break;
      }
    }

    out.set(field.id, filled);
  }

  return out;
}

function signerValue(signer: SignerInk | undefined, fieldId: string): boolean | string | undefined {
  return signer?.values?.[fieldId];
}

function nameFor(role: SignerRole, input: FillInput): string {
  if (role === "CREATOR") return AGREEMENT_PROVIDER.name;
  if (role === "STUDENT") return input.data.student.fullName;
  // A guardian's name is only known from their own signer row - there is nowhere else to get it.
  return input.signers.GUARDIAN?.name ?? "";
}

/** Has every ink box this party owns been filled? What the detail screen reports. */
export function signerComplete(filled: Map<string, FilledField>, signer: SignerRole): boolean {
  const theirs = [...filled.values()].filter((f) => f.field.signer === signer && isInkField(f.field.kind));
  return theirs.length > 0 && theirs.every((f) => !!f.ink);
}

/** The ink one party put on the document, for the running footer. */
export function inkOf(filled: Map<string, FilledField>, signer: SignerRole): string | null {
  for (const f of filled.values()) {
    if (f.field.signer === signer && isInkField(f.field.kind) && f.ink) return f.ink;
  }
  return null;
}
