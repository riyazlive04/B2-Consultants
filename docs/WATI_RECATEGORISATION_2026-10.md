# WhatsApp templates: MARKETING → UTILITY re-categorisation

**Written for:** whoever holds the WATI account and will submit these — not a developer. Nothing
here needs a code change or a deploy.

**Audited against live WATI + live `watiConfig` on 3 October 2026.**

---

## Why this matters

On 1 October a prospect booked a discovery call. Two WhatsApp messages went to the same number
**two seconds apart**:

| Template | Category | Result |
|---|---|---|
| `b2_booking_confirmation` | **UTILITY** | delivered, and read |
| `b2_sop_disco_welcome` | **MARKETING** | **failed** |

The failure reason, verbatim from WATI:

> Message undeliverable as Meta has restricted it for higher quality messaging - retry again in a few days

Three `b2_sop_intro` messages had reached that same number earlier the same evening, so this is
**Meta's per-recipient frequency cap on MARKETING templates** — not a ban, and nothing wrong with
the account. Once a recipient has had a few marketing templates in a window, every further one
fails. The next morning's pre-call reminder failed the same way, so the prospect was never
reminded about a call they had booked.

UTILITY templates are exempt from that cap. That single difference is the whole fix.

**This is not a software bug and no code change can work around it.** The app already detects this
specific error and deliberately refuses to retry, because a retry only adds to the count Meta is
holding against the number.

---

## What the audit found

Of **36** mapped touchpoints in the live config, **28 are MARKETING** and only 8 are UTILITY.

- **13 template names** should be UTILITY and are not. They cover **21 of those 28 touchpoints**.
- **7 touchpoints must stay MARKETING** (listed at the end) — they are genuine re-engagement.

Every body below was rewritten to qualify as UTILITY back in August and **was never submitted**.
They are reproduced verbatim from `scripts/wati-templates-utility-docx.ts`, so they match the
existing `WhatsApp_Templates_UTILITY_Submission_Pack.docx`.

> **Meta categorises by CONTENT, not by the label you pick.** Since April 2025 it re-classifies
> promotional copy to MARKETING regardless of what you declare, and flags accounts that try to
> game it. So these are *rewrites*, not relabels — do not edit promotional lines back in.

---

## Two config fixes to make first (no submission, no deploy)

Both are in the app at **WhatsApp → Settings**, and both would make a send fail outright:

| Touchpoint | Template | Problem |
|---|---|---|
| `BOOKING_CONFIRM_REQUEST` | `b2_booking_confirm_request` | Template declares 3 variables (`1`, `2`, `3`); the mapping supplies **none**. This is the confirm-or-cancel loop — it is currently off, and would fail on the first send if armed. |
| `STAGE_DISCO_COMPLETED` | `170526_attended` | Template declares `name`; the mapping supplies **none**. |

---

## How to submit

A template name already approved as MARKETING usually cannot simply be re-labelled. Two routes:

1. **Request re-categorisation** of the existing name in WATI, pasting the new body below. Cleanest
   if WATI offers it — nothing in the app changes.
2. **Submit under a new name** (e.g. `b2_booking_reminder_u`), then re-point the touchpoint at
   **WhatsApp → Settings**. This needs **no deploy** — the touchpoint-to-template mapping is
   configuration, stored in the database and editable in the app.

After either route, the catalogue in the app needs refreshing: **WhatsApp → Settings → Refresh
templates**. Until you do, the app still believes the old category.

**Check the variable list after re-pointing.** The `params` box for a touchpoint must list exactly
the variables the approved template declares, in order. A mismatch is what produces WATI's
*"Check your template, it cannot have typos or blank text"*.

---

## 1. `b2_booking_reminder`

**MARKETING → UTILITY.** Powers 1 touchpoint: `BOOKING_REMINDER`.

*When it fires:* Before an upcoming booked slot (default 24h and 2h before).

**Body — paste exactly as-is:**

```
Hi {{name}}, a reminder that your discovery call with B2 Consultants is scheduled for *{{slot_time}}* IST.

Please reply *YES* to confirm you'll attend, or pick another time here if needed: {{booking_url}}
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{slot_time}}` | Sat 18 Jul, 07:00 PM |
| `{{booking_url}}` | https://app.b2consultants.de/book |

---

## 2. `b2_booking_rescheduled`

**MARKETING → UTILITY.** Powers 1 touchpoint: `BOOKING_RESCHEDULED`.

*When it fires:* When a call is moved to a new time - manual postpone, or promoted into a freed earlier slot.

**Body — paste exactly as-is:**

```
Hi {{name}}, your discovery call has been rescheduled to *{{slot_time}}* IST.

If this new time doesn't suit you, you can choose another here at your convenience: {{booking_url}}
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{slot_time}}` | Sun 19 Jul, 05:30 PM |
| `{{booking_url}}` | https://app.b2consultants.de/book |

---

## 3. `b2_booking_auto_cancelled`

**MARKETING → UTILITY.** Powers 5 touchpoints: `BOOKING_AUTO_CANCELLED`, `SOP_DISCO_CANCEL`, `SOP_NOT_QUALIFIED`, `STAGE_DISCO_NOT_BOOKED`, `STAGE_LOST`.

*When it fires:* When no confirmation arrives before the cut-off, so the slot is released; invites a rebook.

**Body — paste exactly as-is:**

```
Hi {{name}}, as we didn't receive your confirmation in time, your discovery call slot has been released.

If you'd still like to speak with us, you can book a new time here whenever suits you: {{booking_url}}
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{booking_url}}` | https://app.b2consultants.de/book |

> **Note:** States a fact about an appointment the prospect made and offers the same booking function - it reads as UTILITY. Keep the copy factual (no “don't miss out”, no offer language) or it tips into MARKETING.

---

## 4. `b2_sop_disco_welcome`

**MARKETING → UTILITY.** Powers 2 touchpoints: `SOP_DISCO_WELCOME`, `STAGE_STRATEGY_CALL_BOOKED`.

*When it fires:* When the BANT verdict is YES/MAYBE and the call is booked.

**Body — paste exactly as-is:**

```
Hi {{name}}, this is {{sender}} from B2 Consultants. This confirms your discovery call is scheduled for *{{date}}* at *{{time}}* IST.

Our team is preparing for your call and will be in touch if we need anything further before then. See you soon.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{sender}}` | Nilofer |
| `{{date}}` | Sat 18 Jul |
| `{{time}}` | 07:00 PM |

> **Note:** Original Step 13 linked the case-studies page (social proof). That link is removed here - it is what would force MARKETING. The confirmation itself is transactional.

---

## 5. `b2_sop_disco_confirm_1`

**MARKETING → UTILITY.** Powers 1 touchpoint: `SOP_DISCO_CONFIRM_1`.

*When it fires:* At least 36h before the booked discovery call. Blocked until a Zoom link is on the card.

**Body — paste exactly as-is:**

```
Hi {{name}}, a reminder about your discovery call scheduled for *{{date}}* at *{{time}}* IST.

You can join using this link: {{zoom_link}}

Please reply *YES* to confirm your attendance.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{date}}` | Sat 18 Jul |
| `{{time}}` | 07:00 PM |
| `{{zoom_link}}` | https://us02web.zoom.us/j/85512345678 |

> **Note:** The sales copy (“the possibilities of your next job in Germany”, “figure out your next best steps”) is removed. What remains - appointment time, join link, reply-YES - is a textbook UTILITY confirmation.

---

## 6. `b2_sop_disco_confirm_2`

**MARKETING → UTILITY.** Powers 1 touchpoint: `SOP_DISCO_CONFIRM_2`.

*When it fires:* At least 24h before, if Step 14 drew no reply.

**Body — paste exactly as-is:**

```
Hi {{name}}, we haven't yet received your confirmation for your discovery call on *{{date}}* at *{{time}}* IST.

Your joining link is: {{zoom_link}}

Please reply *YES* to confirm your attendance.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{date}}` | Sat 18 Jul |
| `{{time}}` | 07:00 PM |
| `{{zoom_link}}` | https://us02web.zoom.us/j/85512345678 |

> **Note:** “*FREE* Personalized Discovery Call” is reduced to a plain “discovery call”. No offer language remains.

---

## 7. `b2_sop_disco_cancel`

**MARKETING → UTILITY.** Powers 1 touchpoint: `SOP_DISCO_NOSHOW`.

*When it fires:* At least 12h before, unconfirmed after two confirmation calls.

**Body — paste exactly as-is:**

```
Hi {{name}}, as we didn't receive your confirmation, your discovery call slot has been released.

If you'd still like to speak with us, you can book another time here whenever suits you: https://optin.b2consultants.de/apply
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |

> **Note:** States the slot was released (a fact about the prospect's own appointment) with one functional rebook link. Kept factual - no “don't miss out”.

---

## 8. `b2_sop_sss_confirm_1`

**MARKETING → UTILITY.** Powers 2 touchpoints: `SOP_SSS_CONFIRM_1`, `STAGE_SSS_BOOKED`.

*When it fires:* At least 24h before the SSS. In the SOP this carries a personalised video.

**Body — paste exactly as-is:**

```
Hi {{name}}, this is {{sender}} from B2 Consultants. This is a reminder that your Success Strategy Session is scheduled for *{{date}}* at *{{time}}* IST.

Please reply *YES* to confirm your attendance.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{sender}}` | Nilofer |
| `{{date}}` | Mon 20 Jul |
| `{{time}}` | 06:30 PM |

> **Note:** The SOP's “personalised game plan / video” copy is promotional and is removed to keep this UTILITY. If B2 wants the personalised video, send it as a separate free-form (session) message after the prospect replies, or accept that a video-led template must be MARKETING. As-is, this stays a plain UTILITY confirmation.

---

## 9. `b2_sop_sss_confirm_2`

**MARKETING → UTILITY.** Powers 2 touchpoints: `SOP_SSS_CONFIRM_2`, `SOP_SSS_CONFIRM_3`.

*When it fires:* At least 12h before the SSS, if Step 19 drew no reply.

**Body — paste exactly as-is:**

```
Hi {{name}}, we haven't yet received your confirmation for your Success Strategy Session on *{{date}}* at *{{time}}* IST.

Your joining link is: {{zoom_link}}

Please reply *YES* to confirm.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{date}}` | Mon 20 Jul |
| `{{time}}` | 06:30 PM |
| `{{zoom_link}}` | https://us02web.zoom.us/j/85512345678 |

> **Note:** “He's prepared something very specific… would love to see you there” is removed. A closing line was added so the body doesn't end on the link variable (Meta rejects that).

---

## 10. `b2_sop_sss_cancel`

**MARKETING → UTILITY.** Powers 1 touchpoint: `SOP_SSS_CANCEL`.

*When it fires:* At least 10h before the SSS, still unconfirmed.

**Body — paste exactly as-is:**

```
Hi {{name}}, as we didn't receive your confirmation, your Success Strategy Session slot has been released.

If you'd still like to attend, you can book another time here whenever suits you: https://optin.b2consultants.de/sss
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |

---

## 11. `b2_sss_rescheduled`

**MARKETING → UTILITY.** Powers 2 touchpoints: `SSS_RESCHEDULED`, `STAGE_NO_SHOW`.

*When it fires:* When a Success Strategy Session is moved - founder blocked the slot/day, or a manual/drag reschedule.

**Body — paste exactly as-is:**

```
Hi {{name}}, your Success Strategy Session has been rescheduled to *{{slot_time}}* IST.

If this time doesn't work for you, you can choose another here at your convenience: {{sss_url}}
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{slot_time}}` | Mon 20 Jul, 06:30 PM |
| `{{sss_url}}` | https://optin.b2consultants.de/sss |

---

## 12. `b2_agreement_reminder`

**MARKETING → UTILITY.** Powers 1 touchpoint: `AGREEMENT_REMINDER`.

*When it fires:* When an issued agreement is still unsigned and the link has not expired.

**Body — paste exactly as-is:**

```
Hi {{name}}, a reminder that your coaching agreement (ref *{{document_no}}*) is still awaiting your signature.

You can complete it here before the link expires - it only takes a minute: {{sign_url}}
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{document_no}}` | B2-2026-0142 |
| `{{sign_url}}` | https://app.b2consultants.de/sign/k7Qz2Xp9Rt4Bn |

---

## 13. `b2_payment_reminder`

**MARKETING → UTILITY.** Powers 1 touchpoint: `PAYMENT_REMINDER`.

*When it fires:* For a pending payment that is overdue (balance still owing).

**Body — paste exactly as-is:**

```
Hi {{name}}, this is a reminder that a payment of *{{amount}}* is currently due on your B2 Consultants account.

If you've already paid, please ignore this message. Otherwise, reply here and we'll assist.
```

| Variable | Sample value for review |
|---|---|
| `{{name}}` | Priya |
| `{{amount}}` | ₹25,000 |

---

## Must stay MARKETING — do not submit these as UTILITY

These go to people who have **not** booked anything, or who are being re-engaged. That is
promotional by Meta's definition, and declaring otherwise is what gets an account flagged.

| Touchpoint | Template | Why it cannot be UTILITY |
|---|---|---|
| `SOP_INTRO`, `STAGE_NEW_LEAD` | `b2_sop_intro` | First contact after an opt-in — introduces the service. |
| `SOP_FOLLOWUP`, `SOP_FOLLOWUP_2` | `b2_sop_followup_not_booked` | Chasing someone who booked nothing. Re-engagement. |
| `DISCO_REMINDER` | `b2_disco_reminder` | Sent to people with no booking — a nudge to book. |
| `MANUAL` | `workshop_absent_followup_3` | Workshop follow-up broadcast. |
| `STAGE_DISCO_COMPLETED` | `170526_attended` | Workshop broadcast template. |

Accepting the cap on these is the right trade: none of them is time-critical, and a prospect
who is near their marketing limit missing a *re-engagement* message costs nothing like a prospect
missing the reminder for a call they already booked.

---

## After this lands

The app now watches for exactly this failure. Once an outbound channel stops delivering it raises a
card on the home page and in **Console → System → "Armed but not working"**, and Meta's
per-recipient cap is classified so that it reports as *degraded* rather than paging anyone — see
`src/lib/delivery-health.ts`. Before this change, a dead channel was invisible; that is why the
October failure took three days and a manual question to find.
