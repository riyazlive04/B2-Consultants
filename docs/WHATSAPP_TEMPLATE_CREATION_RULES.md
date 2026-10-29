# Creating a new WhatsApp template

**Written for:** whoever is creating a template — the person writing and submitting the copy, and
the developer wiring the touchpoint. Part 1 needs no code. Part 2 is the code checklist.

**Last reviewed:** 26 October 2026, against the template review of the same date.

These rules are about **creating** a template. They are deliberately stricter than Meta's public
guidelines, because three of Meta's rules fail *silently* in this app — the message is not
delivered and nothing reports an error. Those three are marked ⚠.

---

## Rule 0 — before you write anything, check whether you need a new template

Meta holds **one body per (name, language)**. That single fact drives most of what follows.

- **Editing an approved template is a replacement, not an edit.** The new body goes into review,
  and until it clears **the touchpoint sends nothing** — the app logs a skip, so nobody notices.
  Changing one word costs the same outage as rewriting the message.
- So: a change to *wording* means a re-submission. A change to a *link*, a *time*, a *name* or
  any other value should be a **variable** instead, decided now (see Rule 2).
- A **new name** is cheap. Touchpoint → template is database config at *WhatsApp → Settings*; no
  deploy. When in doubt, submit a new name and keep the old one approved as a fallback.

Check it does not already exist: `npm run docs:whatsapp:all` lists every template in both packs.

---

# Part 1 — writing the template

## Rule 1 — the body

- Say the one thing the message is for. Short paragraphs, blank line between them.
- Explain *why* they are hearing from us, in the first sentence where it is not obvious.
- Keep it tied to something the recipient actually did.
- Check the grammar. A comma splice or a repeated phrase is the most common reason a body comes
  back from review, and the cheapest thing to fix beforehand.
- No false urgency, no unsupported promises, no scarcity copy ("spots are limited"). Besides the
  policy risk, it is what forces an otherwise-UTILITY message into MARKETING.
- Watch for claims that are *accidentally* untrue. In the 26 Oct review one body read "It takes
  less than 2 minutes", where "it" referred back to a 20-minute call. A misleading claim is a
  rejection reason even when nobody meant it.
- Hard cap **1024 characters**, counted *after* variables are substituted.

## Rule 2 — variables

This is where the silent failures are.

- ⚠ **A declared variable that resolves to empty does not send a blank — it cancels the whole
  message.** `sendWhatsApp` skips the send and logs the reason. So every variable you declare
  must be *guaranteed* to have a value at that moment. If a value is sometimes absent, submit
  **two template names** — one with it, one without — and bind the plain one until the data is
  reliable. That is why `b2_booking_confirmation_zoom` and `b2_student_welcome_portal` exist
  beside their plain twins.
- ⚠ **Never begin or end the body with a variable.** Meta rejects it. Put a short static clause
  after a closing link: `… here: {{apply_url}} - it takes under two minutes.`
- ⚠ **Never put two variables next to each other.** Whitespace is not static text, so
  `{{name}}\n{{sender}}` counts as adjacent and is rejected.
- **URLs are variables, not literal text.** Use `{{apply_url}}`, `{{sss_url}}`,
  `{{workshop_url}}`. They are filled from one founder-editable config (*WhatsApp → Settings →
  Public links*), so a landing page can move without a re-submission and without the outage in
  Rule 0. Hardcoding a URL is how this app came to hold three different SSS links at once.
- Give every variable a **realistic sample value** at submission. Meta requires it, and a
  plausible sample is what lets a reviewer judge the message.
- Keep names `lower_snake_case`, and reuse an existing name wherever the value is the same thing
  — the variable pool is in `LEAD_TEMPLATE_VARS` (`src/lib/whatsapp.ts`).
- **Named vs positional.** Write named variables (`{{name}}`). But WATI may hold the approved
  template positionally (`{{1}}`, `{{2}}`), and the app then maps position → variable **by
  counting placeholders**. See Rule 7 — this one has bitten us twice.

## Rule 3 — the category follows the content, not the label

| Category | Use it for |
| --- | --- |
| **UTILITY** | Something that already exists, reported back: an appointment they booked, a payment they owe, an order they placed, a status that changed. |
| **MARKETING** | Anything whose purpose is to get them to take a step they have not taken — "book it", "come back", "any questions about the offer", however politely worded. |
| **AUTHENTICATION** | A one-time passcode. Nothing else in the body — not even their name. |

Since April 2025 Meta classifies by **content** and re-classifies copy that does not match its
declared label, and flags accounts that do it repeatedly. "Make it UTILITY" therefore means
*rewrite the body to be transactional*, never *relabel it*.

This is not a billing detail. MARKETING templates are subject to a **per-recipient frequency
cap**: after a few in a window, every further one fails with *"Meta has restricted it for higher
quality messaging"*. On 1 Oct two messages went to the same number two seconds apart — the
UTILITY one was read, the MARKETING one failed. If a message is time-critical, it must earn
UTILITY honestly or it will eventually not arrive.

Where the honest answer is MARKETING, say so and accept it. `b2_stage_proposal_sent` is
MARKETING and not arguable.

## Rule 4 — links and buttons

- HTTPS only, and a destination that matches what the message says.
- Pass the URL as a variable (Rule 2). Meta wants a verifiable link, so keep the host stable and
  let the *value* come from config rather than the body.
- A URL **button** may carry at most one variable, and only appended to the end of the base URL.
  The app does not send button parameters today — adding that is real work, not configuration.
- Plain button labels: `Book Your Call`, `View Details`.

## Rule 5 — consent

- Send only to someone whose relationship with B2 makes this message expected.
- Never imply they asked for something they did not.
- Honour opt-outs. The app keeps its own opt-out list; a template cannot override it.

## Rule 6 — submission checklist

Before submitting, confirm:

- [ ] The name does not already exist (`npm run docs:whatsapp:all`).
- [ ] Category matches the body's actual purpose.
- [ ] Language is right (`en`).
- [ ] Spelling and grammar checked.
- [ ] Body does not start or end with a variable; no two variables are adjacent.
- [ ] Every variable is guaranteed non-empty for this touchpoint.
- [ ] Every variable has a realistic sample value.
- [ ] Links are HTTPS variables, and the configured values resolve.
- [ ] Under 1024 characters with values substituted.
- [ ] If this replaces an approved body, you know the touchpoint stops sending until it clears.

---

# Part 2 — wiring it in code

A template that is approved but unwired sends nothing, and a template that is wired but
unapproved also sends nothing. Both halves are needed.

1. **Touchpoint.** A new moment needs a `WhatsAppKind` (Prisma enum + migration), a label and a
   hint. A new *stage* message needs none of this — all 17 exist already.
2. **Offer the variables** in `BASE_AVAILABLE_VARS` (`src/lib/whatsapp.ts`). A template declaring
   a variable its touchpoint does not offer is refused outright. Offering is not requiring.
3. ⚠ **Positional layouts.** `WHATSAPP_TEMPLATE_VAR_ORDER` maps `{{1}}, {{2}}…` to variables by
   matching the **placeholder count**. If your template's arity does not match any layout for
   that kind, every send is skipped. Add the layout to `POSITIONAL_ALT_ORDERS`, and give each
   kind **its own entry** — `.find` matches on count alone, so a shared two-variable layout would
   hand one template's `{{2}}` another template's value. A working send to the wrong page is
   worse than no send.
4. **Fill the variables** in `server/lead-template-vars.ts` (lead-facing) or the specific sender.
   Omit a key you cannot fill; never pass `""` — they behave differently, and `""` is what
   produces the skip.
5. **Add it to the pack**: `scripts/wati-templates-utility-docx.ts` (`TEMPLATES`), plus
   `PENDING_SUBMISSION` if it has never been submitted, plus `NEEDS_ACTION` describing what has
   to be done about it. A template held back by a decision belongs in `NEEDS_ACTION` as a
   `DECIDE`, never silently dropped — a deleted line and a taken decision look identical later.
6. **Run the tests.** `npm test` enforces most of this file: declared ⊆ offered, declared ==
   used, samples present, snake_case, no duplicate names, the 1024 cap, no leading/trailing
   variable, no adjacent variables. A failure here is a rejection you did not have to wait for.
7. **Regenerate the documents**: `npm run docs:whatsapp:action` (and `:csv`) is the one people
   work from.
8. **After approval**: *WhatsApp → Settings*, bind the touchpoint to the template name, then
   **Refresh templates** — otherwise the app keeps believing the old category.

---

## What breaks a working template afterwards

- Editing the body in WATI (Rule 0). The touchpoint goes quiet until review clears.
- Binding a variant whose variable is not yet reliably filled (Rule 2) — e.g. a `_zoom` template
  before the Zoom reconciler is armed.
- Letting the catalogue cache go stale: the app decides whether a template is approved from its
  cached copy. Refresh after any change in WATI.
- Binding two engines to the same moment. Several stage messages overlap an SOP step or the
  booking engine; each one's page in the pack names its collision. Bind one.
