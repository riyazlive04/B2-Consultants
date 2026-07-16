# Telecaller pay, lead split & the SSS call — in plain English

_Last updated: 17 Jul 2026. This is the plain-language companion to the Outreach
Specialist script. It explains, without code, how leads are shared out, how
telecallers get paid, and the new rules for Ameen's Success Strategy Session (SSS)
call. Where something is **already built**, it says so; where it's **new work**, it
says that too._

---

## 1. How new leads are shared between the telecallers ("the 80/20")

Every telecaller has a **target share of new leads**. Today that's:

- **Nilofer — 80%**
- **Asma — 20%**

When a new lead arrives, the system looks back over the **last 30 days**, sees who is
**furthest behind their target share**, and gives the lead to that person. Over time
this makes the real split settle on 80/20 by itself. Asma is automatically skipped on
**Saturdays** because she doesn't work them.

**This is already flexible.** To change it:

> People → click a person → **"First-call share %"** and the **"Works Saturdays"**
> checkbox → Save.

Set Nilofer to 70 and Asma to 30, or add a third caller with any share — the rotation
follows immediately. A manager can always hand a specific lead to someone else by
reassigning it on the Pipeline page; that override wins.

---

## 2. How telecallers get paid (commission)

Commission is a **cut of the money a student actually pays**, worked out on **each
payment as it comes in**. If a student owes ₹50,000 and pays ₹10,000 now, the
telecaller earns their cut on that **₹10,000** — and earns the rest later, as the
student pays the rest. (This is the current behaviour and we're keeping it. It can be
revisited later if you decide to pay on the full deal value instead.)

The cut is split across the three people who touched the deal:

| Who | What they did | Their cut (today) |
|-----|---------------|-------------------|
| **First (lead) call** | The telecaller the lead was assigned to | **3%** |
| **Discovery call** | Whoever ran the discovery call | **3%** |
| **Both calls, same person** | One person did the first *and* the discovery call | **5%** (instead of 3+3) |
| **Closer** | Ran the SSS / sales call and closed | **+4%** on top |

### Nilofer & Asma specifically
Nilofer **only does the first (lead) call — never the discovery call.** So she only
ever earns the **3% first-call cut**; she can never reach the 5% "both calls" rate,
because that needs the same person to do both calls. The same logic applies to Asma.
Nothing special needs configuring for this — it's simply how the split already works.

### What's changing here (NEW — small)
Right now those three percentages (**5% / 3% / 4%**) are **fixed in the code** — there's
no screen to change them. We're making them **founder-editable** so you can retune pay
without a developer:

> **Founder Console → Commission → set "Both calls %", "Split %", "Closer %" → Save.**

The moment you save, the Finance → Commission report recalculates on the new rates.

---

## 3. The SSS (sales) call — the new rules

The **SSS = Success Strategy Session**, the closing/sales call that **Ameen** runs after
a prospect's discovery call.

### The situation today
- The **discovery call** already has a proper **calendar of time slots** (each slot is
  Open, Booked, or Blocked; each belongs to a caller). If a prospect goes silent, the
  system can free their slot and move the next person up. That machinery exists.
- The **SSS call does NOT have this.** Today it's just a **single date and time saved
  on the deal** when the Discovery Specialist books it. There is no SSS calendar, no way
  to block a slot, and no automatic rescheduling.

### What you asked for (NEW — the main build)

**(a) Ameen gets a real SSS slot calendar.**
Just like the discovery calendar: Ameen (or an admin) generates SSS time slots. Each
slot can be **Open**, **Booked** (a prospect is scheduled into it), or **Blocked**.

**(b) The founder can block and unblock slots.**
- **Block a single slot** → nobody can be booked into that time.
- **Block a whole day** → the fast path for "I'm not available on Thursday" — every slot
  that day is blocked at once.
- **Unblock** puts a slot back to Open so it can be booked again.

**(c) If the founder blocks a slot/day that already has prospects booked, they are
moved automatically.**
When a slot with a booked prospect gets blocked — or the founder cancels the day — the
system:
1. Takes each affected prospect off that slot.
2. **Moves them to the next available (Open) SSS slot.**
3. Sends them a **WhatsApp** telling them the new time: _"We've had to move your Success
   Strategy Session — your new time is [DATE] at [TIME]. Reply YES to confirm."_
4. Keeps the deal alive — a founder reschedule is **not** a lost deal, and the prospect
   is **not** blamed.

> If there is **no** open slot to move someone into, they go onto a short **"needs a new
> SSS time"** list so a telecaller can rebook them by hand. Nobody is silently dropped.

### How this shows up in the outreach script
The written script's SSS section (Steps 19–22) currently only covers **the prospect
going quiet** — reminders, then a cancellation if they never confirm. It has **no step
for the founder being unavailable.** This adds one new branch:

> **New SSS step — "Founder unavailable / slot blocked":**
> Trigger: an SSS slot with a booked prospect is blocked, or the founder cancels the day.
> Action: auto-move the prospect to the next open SSS slot and send the
> "your session has been moved" WhatsApp. If no open slot exists, flag the prospect for
> manual rebooking. The deal stays in "SSS booked".

This is a **new, separate reason for rescheduling** from the existing "prospect didn't
confirm" flow — the two never conflict.

---

## 4. Build status at a glance

| Item | Status |
|------|--------|
| Flexible lead split (80/20, editable, Saturday rule) | ✅ Already built |
| Nilofer/Asma = first-call cut only | ✅ Already how it works |
| Commission is a cut of what's actually paid, per payment | ✅ Already built |
| Commission rates (5/3/4%) editable by the founder | 🔨 Building now (no DB change) |
| SSS call has a real slot calendar | 🆕 New — needs a database change |
| Founder can block/unblock SSS slots (and whole days) | 🆕 New |
| Booked prospects auto-moved to the next open slot + WhatsApp'd | 🆕 New — extends the existing discovery reschedule engine |
| New "founder unavailable" step in the outreach script | 🆕 New |

---

## 5. Open points worth confirming before the SSS build ships

1. **Who runs the SSS besides Ameen?** The calendar assumes one SSS owner (Ameen). If
   the sales call can be delegated, each SSS slot needs an owner and the auto-move should
   keep a prospect with the same owner.
2. **How far ahead should SSS reschedules look for an open slot?** e.g. only the same
   week, or the next open slot whenever it is.
3. **Confirmation reset:** a moved prospect's confirmation is cleared, so they must reply
   YES again to the new time (same as the discovery reschedule does today). Assumed yes.
