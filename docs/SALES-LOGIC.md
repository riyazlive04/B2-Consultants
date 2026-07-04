# B2 Consultants - Sales logic knowledge base

Source of truth extracted from the operating Excel files (July 2026). This is the
"brain" behind the dashboards: stage definitions, qualification rules, formulas and
benchmarks. When dashboard logic and this document disagree, this document reflects
how the business actually runs - align the code to it.

Sources:

- `Key Metrics Sales B2_2026.xlsx` - Dashboard_26 (monthly funnel) + one sheet per month (per-appointment tracker)
- `Leads from Synamate.xlsx` - raw Meta lead log with speed-to-lead tracking
- `Synamate Appointment booking_210725.xlsx` - discovery-call intake form + BANT triage rules

## 1. The full funnel (in order)

Each month is tracked appointment-by-appointment through these stages
(monthly sheet columns, in order):

1. **Lead** (Meta ad / DM / workshop / summit) → logged with UTM, city, industry
2. **Appointment booked** (Synamate, now in-house /book) - date + time in CET
3. **BANT score** (0-4, one decimal) → **Qualified**: `Yes` / `Maybe` / `No`
4. **WhatsApp sent** (first point touch)
5. **WhatsApp confirmed** (prospect responded)
6. **Discovery call conducted**
7. **Highly Qualified** (after disco call)
8. **SSS call date** + **Sales pattern**: `SSS Call` | `Workshop` | `Summit`
   (from April on, a prospect can be routed to a workshop or summit instead of a
   direct strategy session - all three count as the sales conversation)
9. **Sales call confirmed**
10. **Showed for the call** (show rate)
11. **Offer made** + **Price** (₹, e.g. 79 999 / 136 000 / "35/55" split notation)
12. **Objection** + **Follow up 1 / 2 / 3** (dates - three-touch follow-up cadence)
13. **Final decision** (`Yes` = won) → **Split pay** or **Full pay**
14. Artifacts: Fathom recording link, comments (workshop invitations, context)

## 2. BANT triage rules (operational, from the booking sheet)

| Condition | Result | Action |
|---|---|---|
| BANT score < 2 | **Rejected** | Cancel the appointment |
| BANT score ≥ 2 | **WhatsApp sent** | Wait for response |
| WhatsApp responded | **Call confirmed** | Proceed to discovery call |
| WhatsApp not responded | **WhatsApp not confirmed** | Cancel the appointment |

Other tracked statuses: `Call rejected by B2`, `Offer accepted`, `Client rejected offer`.

Qualified banding used in the tracker: `Yes` ≈ BANT ≥ 3 · `Maybe` ≈ BANT 2-2.9 · `No` < 2.
(High-intent in the app = BANT ≥ 3, which matches `Yes`.)

## 3. Funnel percentage formulas (Dashboard_26 denominators)

Each stage % is conversion **from the previous stage**, not from total leads:

- Apps booked % = appointments ÷ total leads
- Qualified % = BANT-qualified ÷ appointments
- WhatsApp sent % = WA sent ÷ qualified (≈100% - every qualified lead gets first touch)
- WhatsApp confirmed % = WA confirmed ÷ WA sent
- Discovery call % = disco conducted ÷ WA confirmed
- Highly qualified % = HQ ÷ disco conducted
- Sales call confirmed % = confirmed ÷ HQ
- **Show rate** = showed ÷ sales calls confirmed
- **Offer made %** = offers ÷ sales calls confirmed
- **Final +ve decision %** = wins ÷ offers made
- Split pay % / Full pay % = share of wins

⚠ App today: show-up rate = disco completed ÷ disco booked, close rate = won ÷ calls
completed. The sheet measures show + close at the **sales-call (SSS) level**, after the
disco call. The pipeline funnel should eventually track both call layers separately.

## 4. 2026 actual benchmarks (Jan-Jun, from Dashboard_26)

Use these for signal thresholds (ok / watch / risk) instead of guesses:

| Metric | Monthly avg | Range |
|---|---|---|
| Leads | ~650 | 395-962 |
| Appointments booked | 185 | 147-256 |
| Booking rate | 28.5% | 19-51% |
| BANT qualified | 68.5% | 59-82% |
| WA confirmed | 74-96% | - |
| Disco conducted (of WA-confirmed) | ~60% | 52-70% |
| Highly qualified (of disco) | 37% | 27-47% |
| Sales call show rate | 91.6% | 88-100% |
| Offer rate (of confirmed) | 71.5% | 61-90% |
| Close rate (of offers) | 31.7% | 21-50% |
| Wins / month | ~4 | 2-7 |
| Ticket prices seen | ₹14 999 - ₹136 000 (typical ₹69 999-₹79 999) |

## 5. Speed to lead (Synamate lead log)

Per lead: `Date/Time Entered` (UTC + IST), `Who` picked it up (setter initial),
`Time Contacted`, **`Speed Ratio` = time from entry to first contact** (HH:MM).
Target behaviour: same-hour contact; entries show 2-30 min when the desk is staffed.
The app's `speedMs` on Lead matches this definition - keep it.

Lead log fields worth keeping when importing: UTM / Meta ad id (campaign attribution),
city, industry.

## 6. Booking intake form (Synamate → in-house /book)

Columns in the historical intake: appointment date/time (CET), name, email, phone,
WhatsApp, city, current job title, prospect industry, LinkedIn, highest education,
years of experience, why Germany, participated in workshop, reason for call, already
applied?, when to start in Germany, German visa held, German language level,
willingness to learn German, current income bracket, **ready to invest**
(✅ ready / 🤔 maybe / ❌ not in a position), decision making, **commitment**,
how do you know us, **BANT SCORE**, status.

The app's booking form already captures the core (BANT parts, whenStart,
readyToInvest, commitment); gaps if full parity is wanted: LinkedIn, education,
experience, German level, visa status, income bracket, "how do you know us".

## 7. Known gaps between app and sheet logic (for future waves)

- No WhatsApp touchpoint stages (sent / confirmed) between booking and disco call.
- No SSS "sales pattern" (SSS Call vs Workshop vs Summit routing).
- No offer / price / objection / 3-follow-up tracking → no offer-rate or
  close-rate-from-offers metric; app's close rate uses disco completions.
- No split-pay vs full-pay flag on wins (income entries capture instalments instead).
- Lead import keeps no UTM/campaign id → no per-campaign booking-rate attribution.
