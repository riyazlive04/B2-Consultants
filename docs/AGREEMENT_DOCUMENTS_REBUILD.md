# Agreement documents — upload, place, sign

The Agreements section used to be able to produce exactly one document: the Guided Mode clause set,
typeset in code as `agreement-guided-v3/v4.tsx`. Every word of it lives in a React component, so a
new contract — a workshop waiver, a tutor engagement letter, a revised coaching agreement — was a
developer task, not a founder task.

This rebuild keeps the e-signature spine intact and replaces the *source of the document body* with
three interchangeable kinds. What was already there and is not being rebuilt: the tokenised signing
link, the WhatsApp delivery, the OTP that binds the signature to control of the number, the device
record, the append-only `agreement_event` trail, and the once-and-only-once `pdfBytes` seal. Those
are the parts that make an in-house signature worth anything, and none of them care where the prose
came from.

## The three document kinds

`Agreement.documentKind` (and `AgreementTemplate.kind`):

| Kind | Body comes from | Editable in-app | Layout |
| --- | --- | --- | --- |
| `GUIDED` | `agreement-guided-v4.tsx` — unchanged | fields only | typeset in code |
| `DOCX` | a `.docx` parsed into blocks | yes, block by block | faithful re-flow |
| `PDF` | an uploaded PDF, stamped at coordinates | fields only | pixel-exact |

`GUIDED` behaves exactly as it did. Every existing row defaults to it, every existing hash is
unchanged (see *Hashing* below), and `agreement-guided-v3/v4.tsx` are not touched.

`DOCX` is the path the founder asked for: write the draft in Word, upload the `.docx`, and the app
parses it (mammoth → HTML → a strict block model) into something it can re-typeset, re-edit and
merge values into. The trade is layout fidelity: the output is our typesetting of their content, not
Word's.

`PDF` is the Zoho Sign path: export from Word to PDF, upload, and drag signature boxes onto the
pages. The bytes are never re-typeset, so the layout is exactly what Word produced; the cost is that
the prose is no longer editable here — a wording change means a fresh upload.

## Templates vs. the agreement's own copy

```
AgreementTemplate "GM Coaching Agreement"
  └─ AgreementTemplateVersion v1, v2, v3 ← each one an upload + its placed fields
                                  │ instantiate
                                  ▼
       AgreementBody (agreement X)   ← the agreement's OWN copy, editable per person
       AgreementBody (agreement Y)
```

A template version is immutable once an agreement has been drawn from it in the sense that matters:
instantiating **copies** the blocks, the source bytes and the fields onto `agreement_body`. Editing
the template afterwards — or uploading v4 — can never reach a draft that was already instantiated,
let alone an issued one. That is the same reasoning as `Agreement.data` being a frozen snapshot.

A draft agreement can also be given a body with no template at all (a one-off upload), and a draft
instantiated from a template can have its body replaced or edited freely. Both are `DRAFT`-only:
once issued, `agreement_body` is frozen by the same compare-and-set that guards `data`, and once
signed it is frozen by a database trigger.

## Fields

One model covers both kinds (`lib/agreement-doc.ts`):

```ts
type DocField = {
  id: string;
  kind: "SIGNATURE" | "INITIALS" | "DATE" | "NAME" | "TEXT" | "CHECKBOX" | "ATTACHMENT";
  signer: "CREATOR" | "GUARDIAN" | "STUDENT";
  label?: string;
  value?: string;           // a CREATOR TEXT box — typed by the founder while drafting
  required?: boolean;       // only meaningful for a signer-filled kind
  page?: number;            // PDF only, 1-based
  x?: number; y?: number;   // PDF only, normalised 0..1 from the page's top-left
  w?: number; h?: number;   // PDF only, normalised fractions of page width/height
};
```

For `DOCX` the signature zone is a **block in the flow** (`{ type: "field", fieldId }`), because
that is what "a section of the document to be signed" means in a re-flowed document — an absolute
coordinate would land in the wrong place the moment a paragraph above it got longer. Writing
`[[sign:creator]]` or `[[date:student]]` in Word creates one on upload; the editor can also insert,
move and delete them.

For `PDF` the field carries normalised page coordinates, so the box survives a page being a
different size from the one it was placed on.

Nothing can be issued until there is at least one `SIGNATURE` field for `CREATOR` **and** one for
`STUDENT` (`validateDocBody`). A `GUARDIAN` is not a required party — but a guardian given boxes
and nowhere to sign is caught, because it would deadlock the document for everybody. A document nobody has marked up is not signable, and the old
implicit "signature block at the end" is gone for uploaded kinds.

### Who fills what, and when

- `CREATOR` fields are filled at **issue**, from the founder's countersignature (drawn or saved).
- `STUDENT` fields are filled at **signing**, from the one signature drawn in the ceremony.
- One drawn signature fills every `SIGNATURE` field belonging to that signer — the same "apply to
  all" Zoho does. `DATE` is that signer's own timestamp, `NAME` their printed name.
- `TEXT` is in both camps, and that is deliberate: assigned to the `CREATOR` it is a box the
  founder types into while drafting (and it enters the content hash); assigned to a counterparty it
  is a box THEY type into while signing.
- `CHECKBOX`, `ATTACHMENT` and a counterparty's `TEXT` are **signer-filled**: their content is
  produced at signing, so it lands on `Agreement.signerFieldValues` rather than in the frozen body,
  and `required` actually means something for them. An unticked required box blocks signing on the
  client AND on the server; a required attachment is satisfied by bytes we hold, never by a
  filename in the payload.
- `GUARDIAN` signs **before** the student. See *Signing order* below.

## Signing order, and why it is not configurable

The student signs **last**, and their signature is what seals the document. That is not a
preference — it falls out of the strongest guarantee in the module:

`signAgreement` renders the PDF and hashes it in the same write that sets `signedAt`, and
`agreement_seal_immutable` then freezes those bytes forever. A signature collected after the
student's could therefore only reach the document by re-rendering a contract somebody had already
signed.

So a co-signer gets their link at issue, signs through their own ceremony (own token, own one-time
code to their own number, own device record), and the student's ceremony refuses until they are
done. The alternatives were both worse: loosening the trigger gives up the guarantee, and sealing
on "whoever signs last" makes the seal depend on the order people happen to open their email.

A co-signer's refusal kills the agreement for everybody. That is correct: a contract that needed a
guardian's consent and did not get it is not one the student can rescue by signing harder.

## Merge fields

`{{student.fullName}}`, `{{payment.total}}`, `{{document.no}}` … resolved from `Agreement.data` and
the provider constants by `lib/agreement-merge.ts`. This is what makes one uploaded template serve
every student: the money and the party are still the structured, validated `AgreementData` the
invoice, the receivable schedule and the enrol prompt read — the upload only supplies the prose.

An **unknown** token is not silently dropped and not silently printed: `unresolvedMergeTokens`
blocks issuing and the editor names the offending token. A contract with `{{payment.totl}}` printed
in the middle of §7 is worse than one that refused to go out.

## Hashing

`contentHash(data, templateVersion, body?)` hashes the canonical JSON of
`{ templateVersion, data, body? }`. `canonicalJson` drops `undefined` keys, so for a `GUIDED`
agreement — which passes no body — the hashed string is **byte-for-byte what it was before this
feature existed**, and every signed PDF already in the table keeps the content hash printed on its
pages. (`src/lib/__tests__/agreement-doc.test.ts` holds the regression guard, beside the one in
`agreement-payment.test.ts` that pins the legacy payload.)

For uploaded kinds the body contributes:

- `DOCX`: the blocks and the fields — the blocks *are* the prose, so hashing them hashes the terms.
- `PDF`: the fields and the `sourceSha256` of the uploaded bytes, not the bytes themselves. The
  hash stays cheap to compute and still changes if a single byte of the document changes.
- Both: `options`, when any are set. An **empty** options object is excluded explicitly, because
  `canonicalJson` drops `undefined` and not `{}` — so a document that uses none hashes as it did
  before options existed.

What the signer ticked and typed is **not** in `dataSha256`, and should not be: that hash means
"these were the terms offered". Their answers are sealed instead — written in the same statement
that sets `signedAt`, and frozen from then on by the trigger.

The two integrity claims are unchanged in meaning: `dataSha256` proves *what was agreed* and is
reproducible forever; `pdfSha256` proves *the stored artifact is untouched* and is not reproducible.

A third claim is now available, and it is the only one B2 is not the source of: an **RFC 3161
timestamp token** over `pdfSha256`, obtained after sealing and stored verbatim. The other two are
assertions kept in B2's own database; this one is a third party attesting that these exact bytes
existed at a point in time. Off until `AGREEMENT_TSA_URL` is set. See `lib/rfc3161.ts`.

## Rendering

`renderAgreementPdf` dispatches on `templateVersion`, as it already did:

- `guided-v3` / `guided-v4` → the existing components, untouched.
- `upload-docx-v1` → `documents/agreement-upload-docx-v1.tsx`, a react-pdf renderer that typesets
  the block model, resolves merge fields, and draws each field block as a signature zone (ruled box
  + caption while unsigned, ink + date once signed).
- `upload-pdf-v1` → `server/agreement-pdf-overlay.ts`: `pdf-lib` loads the stored bytes, stamps the
  filled fields at their coordinates, adds the running footer (document number + short content
  hash) and the `UNSIGNED` watermark when there is no signature yet, then appends the certificate
  page — which is rendered by react-pdf and merged in, so there is exactly one certificate layout in
  the codebase rather than two that drift.

Preview and seal call the same function for all three kinds, so "what the student read" and "what
they signed" still cannot differ.

## Configuration

Console → Agreements carries four settings: when the module starts *prompting* that an agreement is
ready (unchanged), how a signing link is **delivered** (WhatsApp / email / both), the **signing
window** in days, and which days an unsigned agreement is **chased** on. The chase needs the daily
cron (`/api/cron/agreements`, scheduled in `docker/cron/entrypoint.sh`), and is registered with the
not-armed panel so "no reminder day switched on" is visible rather than silent.

Two environment variables, both optional and both off by default:

| | |
| --- | --- |
| `AGREEMENT_TSA_URL` | An RFC 3161 timestamp authority (https only). Unset means sealed agreements are not timestamped. Only the hash of the PDF ever leaves. |
| `AGREEMENT_TSA_NAME` | What to call that authority on screen. Defaults to the URL's host. |

## What is deliberately *not* here

- **No in-app Word editing.** Word is the editor; this app is the signing system. The block editor
  exists to fix a line and to place fields, not to replace Word.
- **No DOCX→PDF conversion.** It would mean LibreOffice in the image, on a 1 vCPU VPS with no swap.
  The `PDF` kind exists precisely so the founder can get pixel-exact output by exporting from Word
  themselves.
- **No public storage.** Uploaded bodies live in Postgres `bytea` beside `pdfBytes`, for the reason
  the schema already gives: the Supabase bucket is public-read and these documents carry a home
  address and B2's IBANs. Never `select` the byte columns in a list query.
- **No third signer.** `SignerRole` has two members and the ceremony has one token and one OTP.
  Adding a guardian or witness is a second delivery target and a second ceremony, not a new enum
  member.
