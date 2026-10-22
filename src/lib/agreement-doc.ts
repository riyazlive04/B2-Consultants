/**
 * Uploaded agreement documents - the isomorphic core. NO prisma, NO server-only, NO node:crypto,
 * so the founder's editor (client), the PDF renderers and the server actions all import the same
 * definition of what a document IS.
 *
 * Two shapes live here, and the whole feature is built out of them:
 *
 *   DocBlock - one piece of prose. A `.docx` is parsed into an array of these (lib/docx-blocks)
 *              and `documents/agreement-upload-docx-v1.tsx` typesets them. For a DOCX document
 *              the blocks ARE the contract: they are what the renderer prints and what the
 *              content hash hashes.
 *
 *   DocField - a box somebody signs, dates or types into. One model serves both document kinds,
 *              but WHERE it lives differs, and that difference is load-bearing:
 *
 *                DOCX - the field is anchored by a `{ type: "field" }` BLOCK in the text flow.
 *                       A re-typeset document has no stable coordinates: a paragraph three pages
 *                       up getting one line longer would move an absolute box onto the wrong
 *                       clause. The anchor moves with the prose because it IS part of the prose.
 *
 *                PDF  - the field carries `page` + normalised `x/y/w/h`, because the bytes are
 *                       never re-typeset. Normalised rather than PDF points so a box placed on
 *                       an A4 page still lands correctly if the page it is stamped on is Letter.
 *
 * ── THE RULE THAT MAKES THIS SAFE ───────────────────────────────────────────────────────────
 * Like `agreementDataSchema`, these schemas are DESERIALIZERS for frozen snapshots as well as
 * input gates: a stored body is re-parsed through them on every render, and the content hash is
 * derived from the PARSED object. So a rule tightened here is retroactive, and can invalidate the
 * hash printed on a contract that is already executed. Widen freely; never narrow.
 */

import { z } from "zod";

// ───────────────────────────────── Document kinds ─────────────────────────────────

/** Mirrors the Prisma `AgreementDocKind` enum, without importing it into the browser bundle. */
export const DOC_KINDS = ["GUIDED", "DOCX", "PDF"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  GUIDED: "Guided Mode clause set",
  DOCX: "Word document (editable here)",
  PDF: "PDF (exact layout)",
};

/**
 * The renderer pinned on `Agreement.templateVersion` for each uploaded kind.
 *
 * Same contract as "guided-v3"/"guided-v4": the string on the ROW selects the renderer forever,
 * so a fix to the block renderer that changes layout means `upload-docx-v2`, not an edit here.
 */
export const UPLOAD_TEMPLATE_VERSIONS = {
  DOCX: "upload-docx-v1",
  PDF: "upload-pdf-v1",
} as const satisfies Record<Exclude<DocKind, "GUIDED">, string>;

/**
 * The template library's route.
 *
 * It lives HERE, not in `agreement-template-actions.ts`, because that file carries a
 * `"use server"` directive - and every export of such a file must be an async function, since
 * each one becomes a callable RPC endpoint. A `const` export there compiles under tsc and then
 * fails the Next build with "Only async functions are allowed to be exported".
 */
export const AGREEMENT_TEMPLATES_PATH = "/agreements/templates";

export function uploadTemplateVersion(kind: DocKind): string | null {
  return kind === "GUIDED" ? null : UPLOAD_TEMPLATE_VERSIONS[kind];
}

// ───────────────────────────────── Inline runs ─────────────────────────────────

/**
 * A span of text with its marks. Bold/italic/underline only - the three Word carries that a
 * contract ever needs, and the three react-pdf can render from the built-in Helvetica family
 * without registering a font (see the glyph note in the guided templates).
 */
export const docInlineSchema = z.object({
  text: z.string().max(20_000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  u: z.boolean().optional(),
  /** Kept so a link in the draft prints its target; never made clickable in the PDF. */
  href: z.string().max(500).optional(),
});
export type DocInline = z.infer<typeof docInlineSchema>;

const runs = z.array(docInlineSchema).max(400);

export const DOC_ALIGNS = ["left", "center", "right", "justify"] as const;
export type DocAlign = (typeof DOC_ALIGNS)[number];

// ───────────────────────────────── Blocks ─────────────────────────────────

const headingBlock = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  runs,
});

const paragraphBlock = z.object({
  type: z.literal("p"),
  runs,
  align: z.enum(DOC_ALIGNS).optional(),
});

const listBlock = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(runs).max(200),
});

/**
 * The table's limits, NAMED because the editor enforces them too.
 *
 * They were inline `.max()` calls, which made the toolbar's job impossible to get right: a
 * founder who added a thirteenth column would see it appear, type into it, and lose it at the
 * next save when the parse failed this schema. The buttons now disable on these numbers, so the
 * cap is something you are shown rather than something that happens to you.
 */
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 200;

const tableBlock = z.object({
  type: z.literal("table"),
  rows: z
    .array(
      z.object({
        head: z.boolean().optional(),
        cells: z.array(runs).max(MAX_TABLE_COLUMNS),
      }),
    )
    .max(MAX_TABLE_ROWS),
});

/**
 * The signature zone, in the flow. Carries nothing but the id of the field it anchors - every
 * other property (who signs it, what kind of box it is) lives on the field, so moving a box
 * between signers never means touching the prose.
 */
const fieldBlock = z.object({
  type: z.literal("field"),
  fieldId: z.string().min(1).max(40),
});

const pageBreakBlock = z.object({ type: z.literal("pageBreak") });
const ruleBlock = z.object({ type: z.literal("rule") });

export const docBlockSchema = z.discriminatedUnion("type", [
  headingBlock,
  paragraphBlock,
  listBlock,
  tableBlock,
  fieldBlock,
  pageBreakBlock,
  ruleBlock,
]);
export type DocBlock = z.infer<typeof docBlockSchema>;

/** A document of more than 2,000 blocks is not an agreement; it is an upload accident. */
export const docBlocksSchema = z.array(docBlockSchema).max(2000);

// ───────────────────────────────── Fields ─────────────────────────────────

/**
 * WHO fills a field.
 *
 * `GUARDIAN` is a third party on the document - a parent co-signing for a student under 18, or a
 * witness. It is NOT symmetric with the other two, and the asymmetry is the whole design:
 *
 *   CREATOR  - fills at ISSUE, from the founder's countersignature. One of them, always.
 *   GUARDIAN - fills BEFORE the student, through their own link and their own one-time code.
 *   STUDENT  - fills LAST, and their signature is what SEALS the document.
 *
 * The student signing last is not a UX preference. `signAgreement` renders and hashes the PDF in
 * the same write that sets `signedAt`, and the `agreement_seal_immutable` trigger then freezes
 * those bytes forever - so no signature can be added after theirs without either loosening that
 * trigger or re-rendering a sealed contract. Ordering the signers instead keeps the strongest
 * guarantee in the module untouched. See `server/agreement-signers.ts`.
 */
export const SIGNER_ROLES = ["CREATOR", "GUARDIAN", "STUDENT"] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const SIGNER_LABELS: Record<SignerRole, string> = {
  CREATOR: "B2 Consultants (you)",
  GUARDIAN: "Parent / guardian / witness",
  STUDENT: "The student",
};

/** The roles that are a separate PERSON with their own link - everyone except the founder. */
export const COUNTERPARTY_ROLES = ["GUARDIAN", "STUDENT"] as const satisfies readonly SignerRole[];

export const FIELD_KINDS = [
  "SIGNATURE",
  "INITIALS",
  "DATE",
  "NAME",
  "TEXT",
  "CHECKBOX",
  "ATTACHMENT",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  SIGNATURE: "Signature",
  INITIALS: "Initials",
  DATE: "Date signed",
  NAME: "Printed name",
  TEXT: "Text",
  CHECKBOX: "Checkbox",
  ATTACHMENT: "File upload",
};

/**
 * Kinds whose content comes from the SIGNER at signing time, not from the founder at drafting
 * time - so they are stored on the agreement (`signerFieldValues`) rather than inside the frozen
 * body, and `required` actually means something for them.
 *
 * TEXT is in both camps and that is deliberate: a TEXT field assigned to the CREATOR is a box the
 * founder types into while drafting (and it enters the content hash); the same kind assigned to a
 * counterparty is a box THEY type into while signing.
 */
export const SIGNER_FILLED_KINDS = ["TEXT", "CHECKBOX", "ATTACHMENT"] as const;

export function isSignerFilled(field: Pick<DocField, "kind" | "signer">): boolean {
  return (
    field.signer !== "CREATOR" &&
    (SIGNER_FILLED_KINDS as readonly string[]).includes(field.kind)
  );
}

/** Does this field's ink come from a signature pad? */
export function isInkField(kind: FieldKind): boolean {
  return kind === "SIGNATURE" || kind === "INITIALS";
}

/**
 * Normalised page geometry: fractions of the page's own width and height, measured from the
 * TOP-left (the way a browser lays the designer out), never PDF points measured from the bottom.
 * `agreement-pdf-overlay` does the one conversion, at stamping time.
 */
const unit = z.number().min(0).max(1);

/**
 * How long a field's caption may be.
 *
 * Generous, because a CHECKBOX's label is not a caption at all - it is the clause the signer is
 * agreeing to, and it is printed as the tick box's text. "I consent to photographs taken during
 * the workshop being used by B2 Consultants" is an ordinary consent tick and would never have fit
 * in a caption-sized limit. Named rather than written twice: `docx-blocks` truncates to it when
 * it reads a `[[check:student|…]]` placeholder out of a Word file, and this schema is what would
 * reject the result if the two ever disagreed.
 */
export const MAX_FIELD_LABEL = 240;

export const docFieldSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(FIELD_KINDS),
  signer: z.enum(SIGNER_ROLES),
  label: z.string().trim().max(MAX_FIELD_LABEL).optional(),
  /** A CREATOR TEXT box: what the founder typed while drafting. Part of the hash. */
  value: z.string().max(2000).optional(),
  /**
   * Must the signer fill this before they can sign?
   *
   * Only meaningful for a signer-filled kind (`isSignerFilled`) - a signature is mandatory by
   * definition and a date fills itself. Optional with no default, for the reason every other
   * added field here is: `canonicalJson` drops undefined keys, so a document marked up before
   * this existed hashes exactly as it did. A missing flag means "not required", which is what
   * every one of those documents already meant.
   */
  required: z.boolean().optional(),

  // PDF placement. Absent on a DOCX field, which is anchored by its block instead.
  page: z.number().int().min(1).max(300).optional(),
  x: unit.optional(),
  y: unit.optional(),
  w: unit.optional(),
  h: unit.optional(),
});
export type DocField = z.infer<typeof docFieldSchema>;

export const docFieldsSchema = z.array(docFieldSchema).max(60);

/** The default box for a freshly dropped field, as a fraction of the page. */
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { w: number; h: number }> = {
  SIGNATURE: { w: 0.28, h: 0.07 },
  // Initials are a signature's small sibling: square-ish, because that is what two or three
  // letters drawn by hand actually occupy.
  INITIALS: { w: 0.1, h: 0.045 },
  DATE: { w: 0.18, h: 0.035 },
  NAME: { w: 0.26, h: 0.035 },
  TEXT: { w: 0.26, h: 0.035 },
  // A tick box is drawn at a fixed size by the renderers; the stored box is the hit area.
  CHECKBOX: { w: 0.035, h: 0.02 },
  ATTACHMENT: { w: 0.26, h: 0.035 },
};

const WHO: Record<SignerRole, string> = {
  CREATOR: "B2 Consultants",
  GUARDIAN: "Guardian",
  STUDENT: "Student",
};

export function defaultFieldLabel(kind: FieldKind, signer: SignerRole): string {
  const who = WHO[signer];
  switch (kind) {
    case "SIGNATURE":
      return `${who} - signature`;
    case "INITIALS":
      return `${who} - initials`;
    case "DATE":
      return `${who} - date`;
    case "NAME":
      return `${who} - name`;
    case "TEXT":
      return signer === "CREATOR" ? "Fill in" : `${who} - to complete`;
    case "CHECKBOX":
      return "I agree";
    case "ATTACHMENT":
      return `${who} - attach a file`;
  }
}

/**
 * Field ids are SEQUENTIAL, not random, and that is deliberate: they are hashed as part of the
 * body, so a random id would make two otherwise identical documents hash differently and would
 * make the hash depend on the order the founder happened to click in.
 */
export function nextFieldId(existing: readonly { id: string }[]): string {
  let max = 0;
  for (const f of existing) {
    const n = /^f(\d+)$/.exec(f.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `f${max + 1}`;
}

// ───────────────────────────────── The body ─────────────────────────────────

/**
 * An agreement's document body, as every surface passes it around: the editor, the renderers,
 * the hash. Deliberately NOT the Prisma row - `sourceBytes` is absent, because nothing that
 * reasons about a document needs megabytes of it in memory, and `sourceSha256` is what the hash
 * commits to anyway.
 */
/**
 * Per-document switches. Optional, and each one absent by default, so a document marked up before
 * this object existed hashes exactly as it did - the same rule as every added field here.
 */
/**
 * ONE OF THE FOUNDER'S OWN MERGE FIELDS - `{{custom.<token>}}`.
 *
 * `lib/agreement-merge` answers a fixed list of tokens, and that list is deliberately fixed: the
 * money, the party and the dates come from `AgreementData`, which the invoice and the receivable
 * schedule also read, so a Word file must never be able to invent them. But a contract regularly
 * needs a value this app has no opinion about at all - a visa appointment date, a cohort code, a
 * named university - and before this the only way to put one in was to type it into the prose,
 * which turned a one-line edit into a new template version for every student.
 *
 * So these are DECLARED, not discovered: a token nobody defined stays an error, exactly as a
 * mistyped `{{payment.totl}}` does. The pair {definition, value} travels in the document body,
 * which means a template carries the DEFAULT and the agreement drawn from it carries its own
 * copy - so the drafter overrides the value for one student without touching the template.
 *
 * `token` is stored WITHOUT the `custom.` prefix; `customToken()` is the one place that joins
 * them, so the stored name can never drift from what the prose has to say.
 */
export const docCustomFieldSchema = z.object({
  /**
   * Lower-case, starts with a letter, no dots. The dot is what separates the namespace from the
   * name, so allowing one here would let `{{custom.a.b}}` mean two different things.
   */
  token: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,38}$/, "Use lower-case letters, numbers and underscores, starting with a letter."),
  /** What it is called beside the document. Never printed - the VALUE is what prints. */
  label: z.string().min(1).max(60),
  /** What it prints. Blank is allowed while drafting and refused at issue - see `mergeProblems`. */
  value: z.string().max(2000).optional(),
});
export type DocCustomField = z.infer<typeof docCustomFieldSchema>;

/** The prefix that makes a declared name a token. The ONLY place the two are joined. */
export const CUSTOM_TOKEN_PREFIX = "custom.";

/** Named because the editor disables its "add" button on it, rather than failing a save. */
export const MAX_CUSTOM_FIELDS = 30;

export function customToken(field: Pick<DocCustomField, "token">): string {
  return `${CUSTOM_TOKEN_PREFIX}${field.token}`;
}

export const docOptionsSchema = z.object({
  /**
   * Stamp the signers' initials in the footer of every page.
   *
   * The guided clause sets have always done this - "the master initials every page" - and an
   * uploaded PDF could not, because the overlay only touches boxes somebody placed. Per document
   * rather than global: it is right for a contract and wrong for a one-page consent form.
   */
  initialEveryPage: z.boolean().optional(),
  /**
   * The founder's own merge fields. IN `options` RATHER THAN A COLUMN OF ITS OWN, deliberately:
   * `options` is already carried from a template version onto the agreement body drawn from it,
   * already saved by both editors, and already inside `docBodyHashInput` - so a declared value,
   * which is printed prose, enters the content hash with no new plumbing and no migration.
   */
  custom: z.array(docCustomFieldSchema).max(MAX_CUSTOM_FIELDS).optional(),
});
export type DocOptions = z.infer<typeof docOptionsSchema>;

export const docBodySchema = z.object({
  kind: z.enum(["DOCX", "PDF"]),
  blocks: docBlocksSchema.nullable().optional(),
  fields: docFieldsSchema,
  options: docOptionsSchema.optional(),
  sourceName: z.string().max(260),
  sourceSha256: z.string().length(64),
  pageCount: z.number().int().min(1).max(300).nullable().optional(),
  pageSizes: z
    .array(z.object({ w: z.number().positive(), h: z.number().positive() }))
    .max(300)
    .nullable()
    .optional(),
});
export type DocBody = z.infer<typeof docBodySchema>;

/**
 * WHAT THE CONTENT HASH COMMITS TO, for an uploaded document.
 *
 * `canonicalJson` drops undefined keys, so a GUIDED agreement - which never calls this - hashes
 * to exactly the string it hashed before this feature existed. That is the whole reason this
 * returns a narrow object rather than the body row: nothing incidental (a filename, an upload
 * timestamp, a row id) may enter the hash, because the hash must mean "these terms" and not
 * "this upload".
 *
 * For DOCX the blocks are included because they ARE the prose. For PDF only the digest of the
 * bytes is, which is equally binding and far cheaper to canonicalise.
 */
export function docBodyHashInput(body: DocBody): Record<string, unknown> {
  // `options` is spread in only when it has keys, so a document without any hashes exactly as it
  // did before options existed. An empty object would NOT be dropped by `canonicalJson` - only
  // `undefined` is - so the emptiness has to be checked here.
  const options = body.options && Object.keys(body.options).length > 0 ? body.options : undefined;
  return {
    kind: body.kind,
    fields: body.fields,
    sourceSha256: body.sourceSha256,
    ...(body.kind === "DOCX" ? { blocks: body.blocks ?? [] } : {}),
    ...(options ? { options } : {}),
  };
}

// ───────────────────────────────── Validation ─────────────────────────────────

export type DocProblem = { field?: string; message: string };

/**
 * Is this document signable? Called by the editor (to show what is missing) and again by
 * `issueAgreement` (because the editor's answer is advisory).
 *
 * The rule that matters: BOTH parties must have somewhere to sign. The guided clause set had a
 * signature block typeset into it, so this could be taken for granted; an uploaded document has
 * exactly the boxes somebody drew on it, and a contract with no counterparty signature line is
 * not a contract. Issuing is refused rather than falling back to a block at the end - a silent
 * fallback would put B2's signature somewhere nobody chose.
 */
export function validateDocBody(body: DocBody): DocProblem[] {
  const problems: DocProblem[] = [];
  const seen = new Set<string>();

  for (const f of body.fields) {
    if (seen.has(f.id)) problems.push({ field: f.id, message: `Two fields share the id ${f.id}.` });
    seen.add(f.id);
  }

  /**
   * Two definitions of one token is not a tie this code may break: whichever won, half the
   * document would print the other one's value. Zod cannot see across array items, so it is
   * checked here - where every other "the parts do not agree" problem is reported.
   */
  const declared = new Set<string>();
  for (const c of body.options?.custom ?? []) {
    if (declared.has(c.token)) {
      problems.push({ message: `“${customToken(c)}” is defined twice. Remove one of them.` });
    }
    declared.add(c.token);
  }

  if (body.kind === "DOCX") {
    const anchored = new Set(
      (body.blocks ?? []).filter((b) => b.type === "field").map((b) => (b as { fieldId: string }).fieldId),
    );
    for (const f of body.fields) {
      if (!anchored.has(f.id)) {
        problems.push({
          field: f.id,
          message: `“${f.label || defaultFieldLabel(f.kind, f.signer)}” is not placed anywhere in the document.`,
        });
      }
    }
    for (const id of anchored) {
      if (!seen.has(id)) {
        problems.push({ message: `The document has a signature zone with no field behind it (${id}).` });
      }
    }
    if ((body.blocks ?? []).length === 0) {
      problems.push({ message: "This document has no content." });
    }
  } else {
    for (const f of body.fields) {
      const box = placedBox(f);
      if (!box) {
        problems.push({
          field: f.id,
          message: `“${f.label || defaultFieldLabel(f.kind, f.signer)}” has not been placed on a page.`,
        });
        continue;
      }
      if (body.pageCount && box.page > body.pageCount) {
        problems.push({
          field: f.id,
          message: `A field sits on page ${box.page}, but the document has ${body.pageCount}.`,
        });
      }
      if (box.x + box.w > 1.001 || box.y + box.h > 1.001) {
        problems.push({ field: f.id, message: `A field on page ${box.page} runs off the edge of the page.` });
      }
    }
  }

  /**
   * Both NECESSARY parties must have somewhere to sign. A guardian is not one of them - a
   * document only involves one when the founder places a box for them, and an empty
   * `GUARDIAN` role is the normal case rather than an omission.
   */
  for (const role of ["CREATOR", "STUDENT"] as const) {
    const has = body.fields.some((f) => f.signer === role && f.kind === "SIGNATURE");
    if (!has) {
      problems.push({
        message:
          role === "CREATOR"
            ? "Place a signature box for B2 Consultants - you countersign before this is sent."
            : "Place a signature box for the student. Without one there is nothing for them to sign.",
      });
    }
  }

  /**
   * A guardian who has boxes but no signature box can never complete, and the student's ceremony
   * waits for them - so the document would be unsignable by everyone. Caught here rather than
   * discovered by a student staring at "waiting for your guardian".
   */
  const guardianFields = body.fields.filter((f) => f.signer === "GUARDIAN");
  if (guardianFields.length > 0 && !guardianFields.some((f) => f.kind === "SIGNATURE")) {
    problems.push({
      message:
        "This document asks a guardian to fill something but gives them nowhere to sign. Add a guardian signature box, or reassign those fields.",
    });
  }

  // `required` on a field nobody fills is a flag that can never be satisfied or violated.
  for (const f of body.fields) {
    if (f.required && !isSignerFilled(f)) {
      problems.push({
        field: f.id,
        message: `“${f.label || defaultFieldLabel(f.kind, f.signer)}” is marked as required, but nothing is ever typed into it.`,
      });
    }
  }

  return problems;
}

// ───────────────────────────── Signer-filled values ─────────────────────────────

/**
 * What a counterparty typed or ticked, keyed by field id.
 *
 * A separate store from the body on purpose: the body is FROZEN at issue (it is the contract as
 * offered), while these are produced at signing - so they live on the agreement row, enter the
 * seal, and are frozen from then on by the same trigger that guards the ink.
 *
 * `true`/`false` for a checkbox, a string for a text box, and for an attachment the id of the
 * stored `AgreementAttachment` row.
 */
export const signerValuesSchema = z.record(
  z.string().min(1).max(40),
  z.union([z.boolean(), z.string().max(2000)]),
);
export type SignerValues = z.infer<typeof signerValuesSchema>;

export type SignerValueProblem = { fieldId: string; label: string; message: string };

/**
 * Has this signer filled everything they must? Run in the ceremony as they type, and again on the
 * server before anything is sealed - the first is guidance, the second is the gate.
 *
 * An unticked REQUIRED checkbox is the case this exists for: the entire point of a consent box
 * ("I have read §8 - payments are non-refundable") is that signing without it must be impossible.
 */
export function validateSignerValues(
  fields: readonly DocField[],
  signer: SignerRole,
  values: SignerValues,
): SignerValueProblem[] {
  const problems: SignerValueProblem[] = [];
  for (const f of fields) {
    if (f.signer !== signer || !isSignerFilled(f) || !f.required) continue;
    const label = f.label?.trim() || defaultFieldLabel(f.kind, f.signer);
    const value = values[f.id];
    if (f.kind === "CHECKBOX") {
      if (value !== true) problems.push({ fieldId: f.id, label, message: `Please tick “${label}”.` });
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({
        fieldId: f.id,
        label,
        message: f.kind === "ATTACHMENT" ? `Please attach a file for “${label}”.` : `Please fill in “${label}”.`,
      });
    }
  }
  return problems;
}

/** The fields a counterparty is asked to fill, in document order - the ceremony's checklist. */
export function signerInputFields(fields: readonly DocField[], signer: SignerRole): DocField[] {
  return fields.filter((f) => f.signer === signer && isSignerFilled(f));
}

/**
 * A field's PDF placement, or null when it has none.
 *
 * All five coordinates are optional on `DocField` because a DOCX field has none of them, so every
 * reader has to prove they are all present together. One function doing that, rather than five
 * checks inline, is also what keeps "placed" meaning the same thing in the validator and in the
 * stamper.
 */
export function placedBox(
  f: DocField,
): { page: number; x: number; y: number; w: number; h: number } | null {
  const { page, x, y, w, h } = f;
  if (page === undefined || x === undefined || y === undefined || w === undefined || h === undefined) {
    return null;
  }
  return { page, x, y, w, h };
}

/** The fields one signer fills, in document order. */
export function fieldsForSigner(fields: readonly DocField[], signer: SignerRole): DocField[] {
  return fields.filter((f) => f.signer === signer);
}

/** "2 signature boxes · 1 date · B2 and the student" - the one-line summary the lists print. */
/**
 * Plurals, written out.
 *
 * Adding an "s" to the singular label produces "3 date signeds", "2 printed names" and
 * "1 initials" - which appeared on the template cards, in the designer header and in the upload
 * response. English plurals are irregular enough that the only reliable way to get them right is
 * to say what they are.
 */
const FIELD_KIND_PLURALS: Record<FieldKind, string> = {
  SIGNATURE: "signatures",
  INITIALS: "sets of initials",
  DATE: "dates signed",
  NAME: "printed names",
  TEXT: "text boxes",
  CHECKBOX: "tick boxes",
  ATTACHMENT: "file uploads",
};

const FIELD_KIND_SINGULARS: Record<FieldKind, string> = {
  SIGNATURE: "signature",
  INITIALS: "set of initials",
  DATE: "date signed",
  NAME: "printed name",
  TEXT: "text box",
  CHECKBOX: "tick box",
  ATTACHMENT: "file upload",
};

export function describeFields(fields: readonly DocField[]): string {
  if (fields.length === 0) return "No fields placed";
  const counts = new Map<FieldKind, number>();
  for (const f of fields) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const parts = FIELD_KINDS.filter((k) => counts.has(k)).map((k) => {
    const n = counts.get(k)!;
    return `${n} ${n === 1 ? FIELD_KIND_SINGULARS[k] : FIELD_KIND_PLURALS[k]}`;
  });
  return parts.join(" · ");
}

// ───────────────────────────────── Block helpers ─────────────────────────────────

/** Flatten runs to text. Used for merge-token scanning, summaries and the editor's textareas. */
export function runsText(rs: readonly DocInline[]): string {
  return rs.map((r) => r.text).join("");
}

/** Every string a reader will see, block by block - what merge scanning walks. */
export function blockTexts(blocks: readonly DocBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
      case "p":
        out.push(runsText(b.runs));
        break;
      case "list":
        for (const item of b.items) out.push(runsText(item));
        break;
      case "table":
        for (const row of b.rows) for (const cell of row.cells) out.push(runsText(cell));
        break;
      default:
        break;
    }
  }
  return out;
}

/** The first heading or paragraph with words in it - the document's working title. */
export function docTitleOf(blocks: readonly DocBlock[]): string | null {
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "p") {
      const t = runsText(b.runs).trim();
      if (t) return t.slice(0, 120);
    }
  }
  return null;
}

/**
 * Rewrite every visible string in the document, run by run, keeping the marks.
 *
 * This is how merge resolution happens at render time without a second parse: the renderer never
 * sees a `{{token}}`, because the blocks handed to it have already been walked through here.
 */
export function mapBlockText(blocks: readonly DocBlock[], fn: (text: string) => string): DocBlock[] {
  const mapRuns = (rs: readonly DocInline[]): DocInline[] => rs.map((r) => ({ ...r, text: fn(r.text) }));
  return blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return { ...b, runs: mapRuns(b.runs) };
      case "p":
        return { ...b, runs: mapRuns(b.runs) };
      case "list":
        return { ...b, items: b.items.map(mapRuns) };
      case "table":
        return { ...b, rows: b.rows.map((r) => ({ ...r, cells: r.cells.map(mapRuns) })) };
      default:
        return b;
    }
  });
}

/** Move a block up or down, for the editor's arrows. Out-of-range is a no-op, not a throw. */
export function moveBlock(blocks: readonly DocBlock[], from: number, to: number): DocBlock[] {
  if (from < 0 || from >= blocks.length || to < 0 || to >= blocks.length || from === to) {
    return [...blocks];
  }
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
