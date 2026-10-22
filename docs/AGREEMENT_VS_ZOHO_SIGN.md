# Measured against Zoho Sign

This started as a gap analysis against Zoho Sign and is now also the record of closing it. Every
item below is built; the **How it landed** notes say where, and — more usefully — which design
decisions were forced and why.

Sources are Zoho's own product pages, help centre and community announcements, linked at the end.
Several are Zoho marketing rather than documentation, so plan-level claims are indicative.

## Where we match, or go further

| | Zoho Sign | Here |
| --- | --- | --- |
| Place fields by typing in the document | "text tags" — `{{Fullname}}`, field + recipient number, `*` for mandatory | `[[sign:student]]`, `[[check:student\|I have read §8]]`, `[[file:guardian\|ID]]` — every kind the designer can place |
| Drag fields onto PDF pages | yes | yes, normalised coordinates, keyboard-nudgeable |
| Read fields out of a fillable PDF | yes | yes (`agreement-acroform.ts`), with the owner guessed from the field name |
| Reusable templates | yes, referenced live | yes, **copied** onto each agreement, so a template edit can never alter a contract already raised |
| Field types | Signature, Initial, Date, Name, Email, Company, Job title, Text, Checkbox, Radio, Dropdown, Attachment | Signature, Initials, Date, Name, Text, Checkbox, Attachment |
| Prefill from CRM data | `field_data` on a template; community threads report it silently failing | merge fields validated against an allow-list, and an unknown token **blocks sending** |
| Signer identity | optional SMS / email / WhatsApp / offline OTP | WhatsApp OTP, **mandatory**, attempt-capped, rate-limited, constant-time compared |
| Delivery | email by default, SMS extra | WhatsApp **and** email, per-channel outcome reported |
| Reminders | automated | automated, founder-set days, idempotent per day |
| In-person signing | yes (tier feature) | yes |
| Co-signers | signer groups, signing order, delegation | one guardian/witness, who signs **before** the student |
| Bulk send | up to 1,000 | up to 50 per run, per-student outcome |
| Trusted timestamp | QTSP certificate + PAdES LTA | RFC 3161 token over the sealed hash |
| Audit trail | timestamps, metadata, completion certificate | same, plus append-only enforced by **database triggers** over the agreement, its body, its signers and its attachments |
| Integrity | not published | content hash printed on every page, reproducible forever, plus a hash of the sealed bytes |

Three things here have no Zoho equivalent: **copy-on-instantiate**, the **content hash on every
page**, and the **device record that separates what the browser claimed from what our server
observed**.

## Radio buttons, dropdowns and company/job-title fields are still deliberately absent

Not an oversight. A radio group is "one of N", which `DocField` cannot express — it would need a
group identity and an option list, and nothing in a coaching contract has asked for one. Company
and job title are Zoho's B2B fields; here the counterparty is a person. If a document needs one,
a TEXT box assigned to that signer already does the job.

## How each item landed

### 1. Email delivery — `server/agreement-email.ts`

Three emails: the signing link, the nudge, the executed copy (plus a fourth for a co-signer).
Console → Agreements picks WhatsApp, email or both; **both** is the default, because WhatsApp
sending depends on a WATI template being approved and an opted-out number cannot be reached at all.

The forced decision: **a reminder carries no link, and cannot.** Only the SHA-256 of a signing
token is stored, so a link can only be built in the request that minted it. The issue email and the
copy email carry links; the reminder points at the message already sent. Minting a fresh token to
make a prettier reminder would silently break the link in their inbox — which is exactly what
"Sign in person" does do, on purpose, with a warning.

### 2. Checkbox, initials, attachments and `required`

`FIELD_KINDS` gained three members and `DocField` gained `required`. The consequential part is
where a signer's answers live: **on the agreement (`signerFieldValues`), not in the frozen body.**
The body is the contract as *offered* and freezes at issue; ticks and typed text are produced at
*signing*, enter the seal, and are frozen from then on by `agreement_seal_guard`.

Two decisions worth knowing:

- **An untouched optional box on a signed document prints as "Not ticked by the signer", not as
  blank.** Keyed off `signedAt` rather than off whether the browser sent a `false`, so the printed
  contract does not depend on how a form serialises an untouched checkbox.
- **A required attachment is satisfied by bytes we hold**, never by a filename in the payload
  (`attachmentsSatisfied`). Otherwise "required" would mean "the browser said it attached
  something".

### 3. Fillable-PDF detection — `server/agreement-acroform.ts`

Walks each page's `/Annots` rather than using pdf-lib's form API, because a field's widgets do not
carry the page they are on and our coordinates are per page. Every lookup is defensive: one
malformed annotation costs that annotation, not the upload. The owner is guessed from the field
name (`b2_*` → creator, `guardian_*` → guardian, else student) and presented for correction — and
the ordering of those guesses is load-bearing: `student.sign_date` contains "sign", so the date
test runs before the signature test or a date box becomes a second signature box.

### 4. Reminders and expiry — `server/agreement-reminders.ts`, `/api/cron/agreements`

A sweep, not a scheduled job per agreement: the schedule can change under it, the student can sign,
the link can expire. "Already nudged" comes from the append-only trail (`{kind, day}` on the
event), so running it twice in a morning sends nothing twice, and a reminder the founder sent by
hand is visible to it. The TTL moved from a hard-coded 14 days to Console. Registered with the
not-armed panel, so "no reminder day switched on" is visible rather than silent.

### 5. Initial every page — `DocOptions.initialEveryPage`

The guided clause sets have always initialled every page; an uploaded PDF could not, because the
overlay only touches boxes somebody placed. Signed copies only — a footer that *looks* initialled
on a draft would be the one thing on the document that lies.

### 6. In-person signing — `startInPersonSigning`

Mints a fresh link and therefore **kills the one already sent**; there is no way around that, so it
is confirmed rather than one-tap and the dialog says so. The one-time code still goes to the
student's own number, so the identity binding is unchanged, and an `IN_PERSON` event goes on the
trail so the certificate can never imply a link was followed from the student's own phone.

### 7. Signer-side fields and navigation — `_components/SignerFields.tsx`

The document is a PDF in an iframe — a picture — so the placed boxes are reproduced as real
controls in document order, with the captions they carry on the page. Files upload immediately
rather than being held until submit: a signing payload is a server-action argument and cannot carry
megabytes, and a signer on a phone should learn their photo is too large *before* drawing their
name. Required boxes are checked client-side so a missed tick costs a click rather than the code.

### 8. Attachments — `server/agreement-attachments.ts`

Public endpoint, so the guards come from elsewhere: bound to a field of the right kind **and
owner** (the role comes from the token, never the request), magic-byte sniffed, 8 MB cap, one file
per box, refused once sealed, and the stored filename is rebuilt from a safe character set plus the
sniffed extension — never taken from the client, because it is printed on the document.

### 9. Co-signers — `server/agreement-signers.ts`, `server/agreement-cosign.ts`

**The one real design constraint in the whole feature.** `signAgreement` renders the PDF and hashes
it in the same write that sets `signedAt`, and `agreement_seal_immutable` then freezes those bytes.
A signature collected *after* the student's could therefore only reach the document by re-rendering
a contract somebody had already signed.

So co-signers sign **before** the student, and the student's ceremony waits. The alternatives were
both worse: loosening the trigger gives up the module's strongest guarantee, and sealing on
"whoever is last" makes the seal depend on the order people happen to open their email.

A co-signer is a full counterparty — own token, own OTP to their own number, own device record, own
decline — and a decline kills the agreement for everybody, which is correct: a contract that needed
a guardian's consent and did not get it is not one the student can rescue by signing harder.

The ceremony is *parameterised*, not copied (`SignCeremony` takes a `role`), because what must not
differ between the two is the sequence.

### 10. Trusted timestamp — `lib/rfc3161.ts`, `server/agreement-timestamp.ts`

The first claim on the record that B2 is not the source of. Hand-rolled DER rather than an ASN.1
dependency: the request is four fields, the only part of the response we interpret is a status
integer, and the token is stored **verbatim** so verification is `openssl ts -verify` by whoever is
checking, years later. `scripts/verify-agreement-docs.ts` round-trips a request through OpenSSL —
an independent parser — and checks it reports version 1, sha256, our exact digest, a nonce and
certReq.

Off until `AGREEMENT_TSA_URL` is set: this is a request to a third party carrying a hash of a
contract, and that is the founder's choice to make. Only the hash ever leaves.

Taken **after** sealing, because a timestamp is over the final bytes — which is why the four `ts*`
columns are the only ones on a signed agreement the seal guard leaves writable, each written once
under its own `tsToken IS NULL` compare-and-set. Retried by the daily sweep, and a failure is
written to `tsError` so "not timestamped" and "we tried and the authority was down" are
distinguishable on screen.

**What this is not:** a PAdES signature embedded in the PDF. The full version means `@signpdf`, a
certificate to hold and protect, and a judgement about whether a self-held certificate is worth
anything against a QTSP-issued one — realistically "integrate a signing provider", not "write a
signer". The timestamp is the part that was cheap and meaningful.

### 11. Bulk send — `bulkIssueAgreements`, `/agreements/bulk`

A loop over the single-agreement path, deliberately: every student gets their own agreement,
document number, token, code and trail. There is no shared token and no "group agreement". A
student whose record cannot answer every field is **skipped**, not issued with a blank §2, and the
result is a per-student list — "18 sent, 2 need a postal address" is actionable, "20 processed" is
not. Capped at 50 per run, and gated on a saved countersignature being present before the founder
picks anybody.

## Still deliberately not here

- **Radio groups, dropdowns, company/job-title fields** — see above.
- **Formula and conditional fields.** Money comes from validated `AgreementData` and is merged in;
  a formula field would be a second, unvalidated source of truth for a number that reaches an
  invoice.
- **Document groups / envelopes.** Annexures live inside the one document here.
- **Reassign and delegate.** A coaching agreement has one student.
- **Signer groups** ("anyone in this group may sign"). `DocField.signer` is a role, not a person;
  "any one of these five" needs a different field model and no deal has asked for it.
- **More than one guardian.** Same reason: two guardians would own the same boxes and the renderer
  could not say whose ink belongs in which. `addAgreementSigner` refuses the second.
- **One-party documents.** `validateDocBody` requires a signature box for both parties. Right for
  a contract, wrong for an internal policy — if that comes up it should be an explicit document
  kind, not a loosened rule.
- **Word-perfect layout for the DOCX path.** Closed only by a converter (LibreOffice) ruled out on
  a 1 vCPU VPS with no swap. The PDF kind exists for exactly this.
- **Qualified electronic signatures.** A QTSP relationship, not a feature.

## Sources

- [Zoho Sign pricing — feature tiers, in-person signing, signer groups, conditional and formula fields](https://www.zoho.com/sign/pricing.html)
- [Automatic field addition (text tags) in Zoho Sign](https://help.zoho.com/portal/en/community/topic/introducing-automatic-field-addition-text-tags-in-zoho-sign?page=1)
- [Auto-place text tags and automatic field detection for fillable PDFs](https://www.zoho.com/blog/sign/auto-place-text-tags-and-automatic-field-detection-for-fillable-pdfs-in-zoho-sign.html)
- [Fillable and sign field types (Zoho PDF Editor help)](https://www.zoho.com/pdfeditor/help/supported-fillable-and-signature-fields-in-zoho-pdf-editor.html)
- [Adding signer fields via the API](https://www.zoho.com/sign/api/how-tos/signer-fields.html)
- [Prefilling `field_data` — community thread on it failing silently](https://help.zoho.com/portal/pt/community/topic/prefill-field-data-on-zoho-sign-not-populating)
- [Enhanced recipient customisation — authentication methods, private notes](https://help.zoho.com/portal/en/community/topic/feature-announcement-enhanced-recipient-customization-settings?page=11)
- [Sending documents for signature on macOS — per-recipient authentication setup](https://help.zoho.com/portal/en/kb/zoho-sign/mobile-applications/macos/articles/sending-documents-for-signatures-on-macos)
- [Bulk send](https://www.zoho.com/sign/features-and-benefits/bulk-send.html)
- [Signer groups](https://help.zoho.com/portal/pt/community/topic/introducing-signer-groups-streamline-signature-collection-and-make-it-even-faster?page=2)
- [Regional regulatory work — QES via QTSP, LTA timestamps for PAdES](https://help.zoho.com/portal/en/community/topic/improving-zoho-sign-to-navigate-regional-regulatory-landscapes)
- [Signature settings in Zoho Contracts — mandatory authentication, default days to complete](https://help.zoho.com/portal/en/kb/contracts/admin-guide/contract-types/contract-settings/articles/signature-settings-20-1-2026)
- [Zoho Sign free-trial guide — bulk recipients, recipient settings](https://www.zoho.com/blog/sign/zoho-sign-free-trial-guide.html)
