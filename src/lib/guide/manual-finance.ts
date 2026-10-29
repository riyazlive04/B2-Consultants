import { consoleHref, type GuideManual } from "./manual-types";

export const MANUAL_FINANCE: GuideManual[] = [
  // ───────────────────────────────────────── Finance ─────────────────────────────────────────
  {
    section: "finance",
    overview:
      "The daily money screen: every payment received, every cost paid, what students still owe and how the commission splits. It is for the founder (Admin only unless access is widened). Every figure is worked out from the entries themselves each time the page opens, so there is nothing to keep in step by hand.",
    engines: ["commissionAccrual", "tutorFeeAccrual", "invoicePosting", "dunning"],
    features: [
      {
        id: "metric-cards",
        name: "Metric cards",
        where: ["Sidebar", "Finance", "Finance", "Metric cards"],
        href: "/finance",
        what: "Seven cards that sum up the money for the period you picked, each opening the breakdown behind its number.",
        use: [
          "Set the period bar first - every card follows it.",
          "Tap any card to open the breakdown behind its number.",
          "Use the Combined, B2 and German Note switch to see one business on its own.",
        ],
        logic: [
          "Revenue is every income entry dated in the period, each valued at the exchange rate stamped on the day it arrived. Archived entries never count.",
          "Net profit is revenue minus every expense in the period. Gross profit is revenue minus only the expenses marked as COGS. Profit margin is net profit divided by revenue, times 100.",
          "Pending receivables is what is still owed on every Active or Overdue plan. It is a standing figure, so it ignores the period.",
          "Yearly revenue to date always runs from 1 January to today, whatever the period says. Its breakdown shows the programme mix for the selected period.",
          "For the current month, the comparison inside Net profit is the same days of last month. For any other window it is the window of the same length just before it.",
          "Nothing on these cards is stored. They are worked out from the income, expense and pending payment entries every time the page loads.",
          "The cards read the entries, not the background ledger. Switching a ledger posting engine on or off does not change any figure here.",
        ],
        controls: [
          {
            setting: "Who can open Finance",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Sections"],
            href: consoleHref("access", "sections"),
            who: ["ADMIN"],
            default: "Admin only",
            effect:
              "Giving another role access asks you to confirm first, because the screen shows company money, and it applies to every current and future account with that role. Taking access away is one click.",
          },
        ],
        watchOut: [
          "The COGS and Expenses cards say this month in their names, but their figures follow the period bar.",
          "The breakdowns inside the Expenses and COGS cards only list costs dated in the current calendar month. On a past period they can read empty while the card shows a total.",
        ],
        shot: {
          file: "finance-metric-cards.png",
          route: "/finance",
          caption: "The metric cards at the top of Finance. Each one opens the breakdown behind its number.",
          highlight: { text: "Net profit", label: "Tap a card for its breakdown" },
        },
      },
      {
        id: "period-and-business",
        name: "Period bar and business switch",
        where: ["Sidebar", "Finance", "Finance", "Period bar"],
        href: "/finance",
        what: "Choose which dates and which business the whole page reports on.",
        use: [
          "Pick Week, Month, Quarter, Year or All, then step back or forward with the arrows. Now jumps back to the current one.",
          "Pick Custom to choose an exact date range. Both end dates are included.",
          "Pick Combined, B2 or German Note. Each button shows that business's revenue for the period.",
          "Press Income CSV or Expenses CSV to download the entries for the same period.",
        ],
        logic: [
          "The period decides the cards, the Income, Expenses and Commission tables and Team payments. Pending payments ignore it, because an open balance is not an event inside a window.",
          "A payment belongs to German Note when its programme level is a German level or bundle, and to B2 otherwise. This is worked out from the level, never stored, so a new German level lands on the right side by itself.",
          "Costs tagged B2 or German Note land wholly on that business. Shared costs are split between the two by each one's share of revenue in the period, or half each when there is no revenue.",
          "The business you pick is remembered as you move around the app. A link that names a business still wins when someone opens it.",
          "Picking B2 or German Note also pre-selects that business on the income and expense forms.",
        ],
        watchOut: [
          "The CSV downloads follow the period but not the business switch. They always include both businesses.",
          "On B2 or German Note, profit includes an estimated share of shared costs. The note under the switch says how much is measured and how much is estimated.",
        ],
        shot: {
          file: "finance-period-and-business.png",
          route: "/finance",
          caption: "The period bar and the Combined, B2 and German Note switch decide what every figure below covers.",
          highlight: { text: "Custom", label: "Pick the dates" },
        },
      },
      {
        id: "currency-toggle",
        name: "Currency toggle (₹ INR / € EUR)",
        where: ["Sidebar", "Finance", "Finance", "Currency"],
        href: "/finance",
        what: "Choose whether figures lead in rupees or in euros. The other currency sits beneath.",
        use: [
          "Tap ₹ INR or € EUR at the top of the page.",
          "Read the leading figure. The other currency is shown underneath it.",
        ],
        logic: [
          "The toggle never converts. Every entry keeps a rupee value and a euro value of the same money, worked out once at the rate stamped on the day it was entered, and the toggle only picks which one leads.",
          "Because each entry keeps its own rate, last month's figures never move when the exchange rate moves.",
          "Your choice is remembered on this device. The home dashboard and the notification bell follow the same choice.",
          "The Received (₹) and Received (€) columns always show exactly what arrived in each currency. Only the Total column follows the toggle.",
        ],
        watchOut: [
          "Some figures stay in rupees whatever you pick: the Commission tab, and the Month on month and Cumulative tracking charts, because the monthly target is set in rupees.",
        ],
        shot: {
          file: "finance-currency-toggle.png",
          route: "/finance",
          caption: "The currency toggle picks which stored currency leads. It never converts.",
          highlight: { text: "€ EUR", label: "Switch which currency leads" },
        },
      },
      {
        id: "income",
        name: "Income",
        where: ["Sidebar", "Finance", "Finance", "Income"],
        href: "/finance",
        what: "Record every payment received, and start an instalment plan in the same step.",
        use: [
          "Pick the Business first, then the Programme level. The save button stays locked until a business is picked.",
          "Type the Student name and pick them from the list so the payment links to their record. If nobody matches, an admin can tick Create a student record and confirm the name.",
          "Enter the amount in rupees, euros or both, then the Payment type and the Payment method.",
          "For an instalment plan, enter the Number of instalments, the Total price and what was Paid today, then fill in every remaining due date.",
          "If the student already has an open plan, choose it under Settles which receivable?",
          "Press Add income. Use Edit on a row to fix it, or Archive to remove it.",
        ],
        logic: [
          "The exchange rate for the payment date is stamped on the entry when it is saved, so its value in the other currency never changes afterwards.",
          "The payment type's kind decides what the form asks. An instalment type asks for a count and due dates and raises a receivable. A subscription type asks how often it bills and when next, and raises none. A paid-in-full type asks nothing more.",
          "A new instalment plan becomes a receivable straight away. Its total is what was paid today plus every scheduled instalment, and today's payment is stored as instalment 1, already paid.",
          "The Extra price is filled in from the Console price for that number of instalments and can be changed. It is added once to the fee and spread across the instalments.",
          "Every entry is posted to the background ledger in the same step. If that posting is refused, the entry is not saved and the reason is shown above the form.",
          "A date more than 31 days ahead or more than three years back is refused. A payment with the same date, name and amount as an existing one asks you to confirm before saving.",
          "Payment methods are narrowed to the ones that fit the currency typed. Other needs a note saying how the money arrived.",
        ],
        controls: [
          {
            setting: "The payment types offered, and what each kind asks for",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Payment Types"],
            href: consoleHref("money", "payment-types"),
            who: ["ADMIN"],
            default: "Full payment, Instalment and Subscription",
            effect:
              "Switching a type off stops it being offered; entries that already use it keep reading correctly. Changing a type's kind changes what the form asks from then on.",
          },
          {
            setting: "Extra price for paying in a given number of instalments",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Instalment Plans"],
            href: consoleHref("money", "instalment-plans"),
            who: ["ADMIN"],
            default: "₹600 extra on a 3-part plan; 2, 4 and 6 parts at ₹0",
            effect:
              "Only pre-fills the Extra price on new entries. Plans already saved keep what was agreed.",
          },
          {
            setting: "Who can record income, expenses and receivables",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Per-person rules"],
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "Admin only",
            effect: "Takes effect on the person's next save. Entries already made are untouched.",
          },
        ],
        watchOut: [
          "A payment recorded against nobody still counts as revenue, but earns no commission and appears on no student's history.",
          "A student who already has a live plan at that level cannot be given a second schedule; the save is refused. Change the existing plan under Pending payments instead.",
          "Create a student record makes a student with a name, a number and this payment only. They wait on Onboarding under Needs completing until they have a programme and a cohort.",
        ],
        shot: {
          file: "finance-income.png",
          route: "/finance",
          caption: "The Income tab: the entry form, upcoming instalment dates and every payment in the period.",
          highlight: { text: "Add income", label: "Save the payment" },
        },
      },
      {
        id: "expenses",
        name: "Expenses",
        where: ["Sidebar", "Finance", "Finance", "Expenses"],
        href: "/finance?tab=1",
        what: "Record every cost paid, which business it belongs to and which account it came out of.",
        use: [
          "Enter the Date and the amount in rupees, euros or both, then pick the Expense category.",
          "Pick Paid from - the account the money actually left.",
          "Pick the Business line: B2 only, German Note only, or Shared for costs like rent, ads and tools.",
          "Fill in Paid to, and tick Is this COGS? for a direct cost of delivering a programme.",
          "Press Add expense. Use Edit or Archive on a row to change or remove it.",
        ],
        logic: [
          "The exchange rate for the expense date is stamped on the entry, just as for income.",
          "A cost is COGS when you tick the box or when its category is a COGS category. Under a COGS category it stays COGS even with the box clear.",
          "Each category posts to its own line in the background ledger, and Paid from is the account the ledger takes the money out of. Bank - INR is used when nothing else is picked.",
          "Shared costs appear on both the B2 and German Note views and are split between them by revenue share.",
          "Picking Team Salaries and Commissions turns Paid to into a team picker and fills in that person's agreed monthly pay.",
        ],
        controls: [
          {
            setting: "The expense categories, their ledger line and their COGS default",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Expense categories"],
            href: consoleHref("money", "expense-categories"),
            who: ["ADMIN"],
            default: "8 categories, with COGS - Direct Delivery Cost the only COGS one",
            effect:
              "Costs already recorded keep the ledger line they were posted to until someone edits them. A category switched off stops being offered and old costs under it still read correctly. Team salaries, COGS and Other can be renamed or switched off but not removed.",
          },
        ],
        watchOut: [
          "Platform subscriptions such as Skool are Tools and Software, not COGS. The form says so beside the tick box.",
          "A team salary row not linked to a person is marked unlinked and counts in nobody's pay total. Edit it and pick the person.",
        ],
        shot: {
          file: "finance-expenses.png",
          route: "/finance?tab=1",
          caption: "The Expenses tab: the daily expense form, Team payments and every cost in the period.",
          highlight: { text: "Add expense", label: "Save the cost" },
        },
      },
      {
        id: "team-payments",
        name: "Team payments",
        where: ["Sidebar", "Finance", "Finance", "Expenses", "Team payments"],
        href: "/finance?tab=1",
        what: "Who on the team is paid what in a normal month, and what has actually gone out in the period.",
        use: [
          "Open the Expenses tab. The panel sits between the form and the table.",
          "Click the Agreed / month figure, or Set pay, to record a person's normal monthly pay.",
          "Press Pay on a row. The form above switches to team pay, picks the person and fills in their monthly pay.",
          "Change the amount for a part month or a bonus, then press Add expense.",
        ],
        logic: [
          "Paid is every cost in the period linked to that person, each at its own stamped rate.",
          "Still to pay is agreed monthly pay minus what was paid in the period, never below zero. It only shows when the period is about one month long.",
          "Last paid is the latest payment to that person ever, not only in the period.",
          "The payments list includes team salary rows linked to nobody, flagged unlinked. They count in the panel total but in no one's row.",
          "Former team members are listed only while they have a payment in the period.",
          "A bonus or commission marked Paid on the Bonus & Commission board appears here by itself as a payment.",
        ],
        controls: [
          {
            setting: "A person's agreed monthly pay",
            where: ["Sidebar", "Finance", "Finance", "Expenses", "Team payments"],
            href: "/finance?tab=1",
            who: ["ADMIN"],
            effect:
              "It is one figure per person, not a history, so Still to pay for any month you look at uses the new figure. Payments already recorded are untouched.",
          },
        ],
        shot: {
          file: "finance-team-payments.png",
          route: "/finance?tab=1",
          caption: "Team payments: agreed monthly pay against what has actually been paid in the period.",
          highlight: { text: "Team payments", label: "Who is owed what" },
        },
      },
      {
        id: "pending-payments",
        name: "Pending payments",
        where: ["Sidebar", "Finance", "Finance", "Pending payments"],
        href: "/finance?tab=2",
        what: "Every fee a student has agreed to pay and has not finished paying, with their instalments.",
        use: [
          "Under Raise a receivable, pick the student and Programme level, enter the Total fee agreed and the Next payment due date, then press Add pending payment.",
          "Press EMI on a row to split the fee into instalments: enter the number, the first due date and the days between, check the preview, then press Generate schedule.",
          "Press Collect on a row to see what has come in, record a payment against that plan, tick an instalment paid, move the due date or change the status.",
          "Press Remind to send the student a WhatsApp payment reminder. It only appears when the student has a phone number and still owes money.",
        ],
        logic: [
          "Collected is worked out, never typed. A payment that names this plan counts only here. Other payments from the same student fill their plans oldest first, each only up to its own total.",
          "Money left over after every plan is full is shown as received beyond what the open plans ask for.",
          "Still to collect is the fee plus any plan extra, minus Collected. A row turns red as Overdue when money is still owed and the next due date has passed.",
          "A plan shows Paid in full by itself once nothing is left and every instalment is paid. Paid in full and Dropped, when chosen by hand, are never overridden.",
          "Generating a schedule copies the Console extra for that number of instalments onto the plan, so later price changes do not move it. The last instalment absorbs any rounding.",
          "Only a payment recorded with an instalment-type payment type ticks instalments off by itself, and only the ones it covers in full. Any other payment lowers the balance but leaves the instalment rows as they were.",
          "Archiving a payment un-ticks the instalments it had paid. Restoring it ticks them again.",
        ],
        controls: [
          {
            setting: "Default days between instalments, and the extra per plan length",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Instalment Plans"],
            href: consoleHref("money", "instalment-plans"),
            who: ["ADMIN"],
            default: "30 days apart; ₹600 extra on a 3-part plan",
            effect:
              "Forward only. A plan's extra is copied on when its schedule is generated, so existing schedules keep theirs.",
          },
          {
            setting: "Automatic chasing of instalments (payment chasing)",
            where: ["Sidebar", "Admin", "Founder Console", "System", "Alerts & Chasing"],
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "Off. When switched on: by email 10 days before, 1 day after and 7 days after a due date",
            effect:
              "Starts chasing instalments that are due or overdue on the next scheduled run, and reaches real students. Plans without an instalment schedule are never chased.",
          },
        ],
        watchOut: [
          "Enter the whole agreed fee as the total, not what is left. Payments already made are taken off by themselves.",
          "A plan linked to a student only counts payments linked to that same student. A payment typed under the name alone sits outside it.",
          "A receivable with no instalment schedule is a single balance, and nothing chases it automatically.",
          "Clear schedule deletes every instalment row, paid ones included. The receivable itself stays.",
        ],
        shot: {
          file: "finance-pending-payments.png",
          route: "/finance?tab=2",
          caption: "Pending payments: what each student agreed, what has come in and what is still to collect.",
          highlight: { text: "Raise a receivable", label: "Record an agreed fee" },
        },
      },
      {
        id: "commission",
        name: "Commission",
        where: ["Sidebar", "Finance", "Finance", "Commission"],
        href: "/finance?tab=3",
        what: "How every student payment in the period splits across the people who worked the deal.",
        use: [
          "Set the period bar to the month you are paying out.",
          "Read each person's total at the top, then each payment's split in the table.",
          "Fix anything flagged: give the lead a first-caller on Pipeline, record the discovery outcome, or record who covered a call on a day off.",
          "To keep a record of this month's totals, press Record this month's payout on the Maintenance panel.",
        ],
        logic: [
          "Only payments linked to a student record count. Each is split across the people on that student's lead.",
          "First call is whoever the lead is assigned to now. Discovery is whoever recorded the lead's latest discovery outcome. Closer is the closer named on the enrolment the payment is linked to.",
          "One person on both calls earns 5% by default. Two different people earn 3% each by default, and a lone first-call or discovery leg also earns 3%. A closer earns 4% on top by default.",
          "When a stand-in covered someone's discovery slot, that leg is divided: the stand-in keeps 20% of it by default and the slot's owner the rest. It costs nothing extra.",
          "Every rate is a share of the money actually received, worked out on the payment's rupee value at its own stamped rate.",
          "Nothing is stored. The report is worked out again each time with today's rates and today's eligibility, for whichever period you pick.",
          "A person who is not eligible for a leg still appears, struck through at zero, with the reason beside them.",
        ],
        controls: [
          {
            setting: "Commission rates",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Commission"],
            href: consoleHref("money", "commission"),
            who: ["ADMIN"],
            default: "5% both calls, 3% each when split, 4% closer, 20% substitute share",
            effect:
              "Every month's report, past months included, is worked out again at the new rates the next time it opens. Only a payout already recorded keeps its saved totals.",
            reset: "Press reset in the panel to put back 5, 3, 4 and 20, then save.",
          },
          {
            setting: "Which legs each person is eligible to earn",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Per-person rules"],
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "Admins and telecallers earn every leg",
            effect:
              "Applies to every month's report, past ones included. Someone who has been deactivated keeps what the report showed for them.",
          },
          {
            setting: "Record this month's payout, and book it in the ledger as money owed",
            where: ["Sidebar", "Admin", "Founder Console", "System", "Maintenance"],
            href: consoleHref("system", "maintenance"),
            who: ["ADMIN"],
            default: "Booking as money owed is Off",
            effect:
              "Recording saves this month's totals as a payout record. With booking on, it also enters the total as owed in the background ledger. No figure on Finance changes.",
          },
        ],
        watchOut: [
          "Reassigning a lead to another telecaller moves that lead's first-call commission to them, for past months too.",
          "A head coach is not eligible for any leg by default, so their line shows at zero until it is granted.",
          "Record this month's payout only covers the current calendar month. Recording it again updates the saved totals, but once it has been booked in the ledger the booked amount stays as it was.",
        ],
        shot: {
          file: "finance-commission.png",
          route: "/finance?tab=3",
          caption: "The Commission tab: each person's total, and how every student payment was split.",
          highlight: { text: "Commission", label: "The deal-team split" },
        },
      },
      {
        id: "archived",
        name: "Archived",
        where: ["Sidebar", "Finance", "Finance", "Archived"],
        href: "/finance?tab=4",
        what: "Archived income entries, expenses and pending payments, ready to restore or delete for good.",
        use: [
          "Open Archived to see what has been archived from the other tabs.",
          "Press Restore to bring an entry back.",
          "An admin can press Delete permanently to remove one for good.",
        ],
        logic: [
          "Archiving takes an entry out of every total and cancels its ledger posting. Nothing is deleted.",
          "Restoring posts the entry to the ledger again and puts it back into every total.",
          "Restoring a payment ticks off instalments again against the schedule as it stands now, which may have moved on while it was archived.",
          "Archived entries are deleted for good by the daily clean-up once they are 90 days old.",
        ],
        watchOut: ["Delete permanently cannot be undone."],
        shot: {
          file: "finance-archived.png",
          route: "/finance?tab=4",
          caption: "The Archived tab: restore an entry, or delete it for good.",
          highlight: { text: "Archived", label: "Archived entries" },
        },
      },
      {
        id: "review-charts",
        name: "Earned vs collected and the year charts",
        where: ["Sidebar", "Finance", "Finance", "Below the tabs"],
        href: "/finance",
        what: "Review material: how much cash has been earned yet, and how the year is tracking against target.",
        use: [
          "Scroll below the tabs.",
          "Read Earned vs collected to see how much of the period's cash has been delivered yet.",
          "Hover a month on Month on month or Cumulative tracking to see plan, actual and pace.",
          "Read Client movement for students gained and lost each month.",
        ],
        logic: [
          "Cash collected is money that arrived in the period. Revenue earned spreads each payment evenly across its programme's length. Deferred is collected but not yet delivered.",
          "A payment not linked to an enrolment is treated as earned on the day it arrived. The note under the card says how much of the figure rests on that.",
          "Month on month and Cumulative tracking compare each month with its target. A month with no target set uses ₹8,00,000.",
          "Those two charts cover the calendar year and are in rupees only, whatever the period bar and the toggle say.",
          "Client movement counts students gained by enrolment date and lost only when an enrolment is dropped. Finishing a programme is not counted as a loss.",
        ],
        controls: [
          {
            setting: "Monthly revenue target used by the year charts",
            where: ["Sidebar", "Sales", "Pipeline"],
            href: "/pipeline",
            who: ["ADMIN"],
            default: "₹8,00,000 a month",
            effect: "Changes that month's target on both year charts at once. Recorded income is untouched.",
          },
        ],
        shot: {
          file: "finance-review-charts.png",
          route: "/finance",
          caption: "Earned vs collected, and the year charts, below the entry tabs.",
          highlight: { text: "Revenue earned", label: "Earned, not just collected" },
        },
      },
    ],
    related: [
      { section: "cash", why: "Cash Health reads the same pending payments and expenses. Its receivables, overdue figures and burn all come from here." },
      { section: "payments", why: "Recording a payment against an invoice adds the matching income entry here by itself." },
      { section: "telecaller", why: "A bonus or commission marked Paid there becomes a team salary expense here." },
      { section: "pipeline", why: "Commission follows who the lead is assigned to and who recorded the discovery outcome. The year charts use the Pipeline monthly target." },
      { section: "students", why: "A payment linked to a student builds their payment history." },
      { section: "onboarding", why: "A student created from a payment waits under Needs completing until they have a programme and a cohort." },
      { section: "my-desk", why: "Telecallers see their own share of this month's commission on My Desk." },
      { section: "console", why: "Commission rates, payment types, instalment prices, expense categories and the ledger posting switches all live in the Founder Console." },
    ],
    faq: [
      {
        q: "Why does a payment show no commission?",
        a: "It needs a student linked on the income entry, and that student's lead needs an assigned first-caller or a recorded discovery outcome. Otherwise the Rule column says Unattributed.",
      },
      {
        q: "The Expenses card shows a total, but its breakdown says there are no expenses. Why?",
        a: "The breakdown only lists costs dated in the current calendar month. On any other period it can be empty while the card is right.",
      },
      {
        q: "I switched on commission posting but Net profit did not change. Is it broken?",
        a: "No. The cards are built from income and expense entries. The posting switches only write to the background ledger, which has no screen. To count a payout in profit, it has to be paid as an expense.",
      },
      {
        q: "A student paid, but their plan still shows money to collect. Why?",
        a: "The payment is probably not linked to the same student record as the plan, or it named a different plan. Open Collect on the plan to see every payment and which plan each one names.",
      },
      {
        q: "Why is Pending receivables here different from Receivables on Cash Health?",
        a: "Finance counts plans whose status is Active or Overdue. Cash Health only counts plans whose status is Active, so a plan set to Overdue by hand shows here but not there.",
      },
    ],
  },

  // ───────────────────────────────────────── Cash Health ─────────────────────────────────────────
  {
    section: "cash",
    overview:
      "Survival maths for the founder: how much cash there is, how long it lasts at the current spend, who owes money and what bills are coming. It is Admin only by default. Almost everything here is worked out from Finance and from the bank balance you type each Monday.",
    features: [
      {
        id: "top-numbers",
        name: "Top numbers",
        where: ["Sidebar", "Finance", "Cash Health", "Top numbers"],
        href: "/cash",
        what: "Five numbers that say how much cash there is and what is coming in and going out.",
        use: [
          "Read Cash in Hand first. If it says stale, enter this week's bank balance just below it.",
          "Hover the info mark beside Cash in Hand to see exactly what it is.",
          "Use Receivables, Overdue and Expected in next 30 days to decide who to chase.",
        ],
        logic: [
          "Cash in Hand is the bank balance typed on the most recent weekly cash position. It is not worked out from income and expenses.",
          "It is marked stale when the latest entry is more than 7 days old.",
          "Receivables is what is still owed on every plan with the status Active, pulled straight from Finance pending payments.",
          "Overdue is the part owed on plans whose next due date has passed. Expected in next 30 days is the full remaining balance of plans whose next due date falls in the next 30 days.",
          "Payables due this month adds up the active payables whose next date falls in this calendar month.",
          "Everything on Cash Health is in rupees. A euro amount is valued at the rate stamped on its own entry.",
        ],
        watchOut: [
          "Only plans with the status Active count here. A plan whose status was set to Overdue by hand still shows on Finance, but not on Cash Health.",
          "Expected in next 30 days is each plan's whole remaining balance, not just the next instalment.",
        ],
        shot: {
          file: "cash-top-numbers.png",
          route: "/cash",
          caption: "The five top numbers on Cash Health.",
          highlight: { text: "Expected in next 30 days", label: "Money due soon" },
        },
      },
      {
        id: "cash-position",
        name: "Cash position",
        where: ["Sidebar", "Finance", "Cash Health", "Cash position"],
        href: "/cash",
        what: "The weekly bank balance that runway and the top-bar runway badge are built from.",
        use: [
          "Every Monday, under Weekly cash position, enter the Date of entry and the Business bank balance (₹).",
          "Add a note for anything unusual, such as a large payment made or expected, then press Save position.",
          "Open the Cash position tab to see past entries.",
          "Use 12 weeks, 6 months, 12 months or 4 quarters on the Cash in Hand chart to change its window.",
        ],
        logic: [
          "There is one entry per date. Saving the same date again replaces that day's balance.",
          "Runway, the payable warnings and the runway badge in the top bar all read the latest entry, whatever its date.",
          "The balance is typed in rupees only.",
          "Owners' money is never added on top. It is already inside the bank balance once it has arrived.",
        ],
        controls: [
          {
            setting: "Who can enter cash positions, payables and equity",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Per-person rules"],
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "Admin only",
            effect: "Takes effect on the person's next save. Entries already made are untouched.",
          },
        ],
        watchOut: [
          "Skip a Monday and every figure built on Cash in Hand goes on using the old balance.",
        ],
        shot: {
          file: "cash-cash-position.png",
          route: "/cash",
          caption: "The weekly cash position form sits right under the top numbers.",
          highlight: { text: "Save position", label: "Enter Monday's balance" },
        },
      },
      {
        id: "runway",
        name: "Cash runway",
        where: ["Sidebar", "Finance", "Cash Health", "Cash runway"],
        href: "/cash",
        what: "How many months the business lasts if no new money came in, and what revenue it needs to break even.",
        use: [
          "Read the months on the gauge and the date cash would reach zero.",
          "Check the line under it for one-time payables already committed, and the runway left after them.",
          "Compare Break-even revenue / month with This month vs break-even.",
          "To test a growth assumption, type a figure in Growth % override and press Set. Clear the box and press Set to go back to auto.",
        ],
        logic: [
          "Runway is Cash in Hand divided by burn, to one decimal. Burn is the average monthly expenses over the last 3 complete months by default. The current month is left out, and months with no expenses recorded are skipped.",
          "The zero date is today plus the runway months, at about 30 days a month.",
          "The colour is green at 6 months or more, amber from 3 months and red below 3, by default. The runway badge in the top bar uses the same rule and is shown to admins only.",
          "Break-even is the monthly cost of every active payable: quarterly bills divided by 3, annual by 12. One-time payables are left out and shown as a separate committed amount that reduces runway on its own line.",
          "This month vs break-even is this calendar month's revenue minus break-even.",
          "Months to the target grows this month's revenue by the growth rate, month after month, until it reaches the target. The automatic growth rate is the average month-on-month change over the last four calendar months, this one included.",
        ],
        controls: [
          {
            setting: "Runway colours, burn window, gauge size, revenue target and cash buffer",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Cash targets"],
            href: consoleHref("money", "cash-targets"),
            who: ["ADMIN"],
            default: "Green at 6 months, amber at 3, gauge 12 months, burn over 3 months, target ₹8,00,000 a month, buffer 2 times the bill",
            effect:
              "Nothing recorded changes. Runway, its colour and the top-bar badge are judged again straight away.",
          },
          {
            setting: "Growth % override for Months to target",
            where: ["Sidebar", "Finance", "Cash Health", "Cash runway"],
            href: "/cash",
            who: ["ADMIN"],
            default: "Auto (measured from recent revenue)",
            effect: "Only changes the Months to target figure. It accepts -50 to 200.",
            reset: "Clear the box and press Set.",
          },
        ],
        watchOut: [
          "An expense recorded today does not change runway until the month is over, because burn only uses complete months.",
          "The revenue target here is set in Cash targets. It is separate from the monthly target on the Pipeline target bar that the Finance year charts use.",
        ],
        shot: {
          file: "cash-runway.png",
          route: "/cash",
          caption: "The runway gauge, with break-even and the months to the revenue target beneath it.",
          highlight: { text: "Break-even revenue / month", label: "What you must earn each month" },
        },
      },
      {
        id: "receivables",
        name: "Receivables",
        where: ["Sidebar", "Finance", "Cash Health", "Receivables"],
        href: "/cash?tab=1",
        what: "Who owes money, how late it is, and the place to settle a balance without leaving the page.",
        use: [
          "Read Age analysis of due balance to see who is 1, 2, 3 or 4+ weeks late.",
          "Use Receivables breakup to see how much is past due, due within 30 days or due later.",
          "Click a student's name in Top receivables by balance or on the Receivables tab to open their balance.",
          "From there, record the payment, tick an instalment paid, move the due date or change the status.",
          "Tap the cards on the Receivables tab to see the students behind each figure.",
        ],
        logic: [
          "Nothing here is entered on this page. It is pulled from Finance pending payments, so update those and this follows.",
          "Each age bar is scaled to that student's own agreed fee, so a part-paid balance does not look like the whole fee.",
          "The Receivables tab is marked with a warning when the oldest overdue balance is more than 14 days late.",
          "Recording a payment here uses the same form and the same rules as the Finance Income tab, already pointed at this plan.",
        ],
        watchOut: [
          "Changing the status does not clear a balance. Recording the money does.",
        ],
        shot: {
          file: "cash-receivables.png",
          route: "/cash?tab=1",
          caption: "The Receivables tab: totals, overdue students and every open balance.",
          highlight: { text: "Total receivables", label: "Everything still owed" },
        },
      },
      {
        id: "owners-equity",
        name: "Owner's equity",
        where: ["Sidebar", "Finance", "Cash Health", "Owner's equity"],
        href: "/cash?tab=2",
        what: "Money the owners put into the business or take back out, and each person's stake.",
        use: [
          "Under Record an equity entry, pick the Date, type Who, and choose the Direction: money put in or money taken out.",
          "Pick Into / out of: the account the money actually moved through.",
          "Enter the amount in rupees, euros or both, add a note and press Record entry.",
          "Check By contributor for each person's stake. Edit or Archive entries under Every entry.",
        ],
        logic: [
          "Equity is not revenue. It never reaches profit and loss, so it does not move revenue, profit, margin or commission.",
          "It is not added to Cash in Hand, because the bank balance already contains the money once it has arrived.",
          "Money taken out counts as negative, so Stake in the business is money put in minus money taken out.",
          "Each entry is posted to the ledger as Owner's equity. If the posting is refused, the entry is kept and flagged as not posted, and the tab label shows a warning mark.",
          "Every total is worked out from the entries, never stored.",
        ],
        watchOut: ["The person does not need a login. Type their name the same way every time, or they split into two contributors."],
        shot: {
          file: "cash-owners-equity.png",
          route: "/cash?tab=2",
          caption: "The Owner's equity tab: what each owner has put in and taken out.",
          highlight: { text: "Record an equity entry", label: "Record money put in or taken out" },
        },
      },
      {
        id: "payables",
        name: "Payables",
        where: ["Sidebar", "Finance", "Cash Health", "Payables"],
        href: "/cash?tab=3",
        what: "The bills the business has committed to, which set the break-even line.",
        use: [
          "Press Add payable.",
          "Enter the Payable name, the Category and the Price in rupees, euros or both.",
          "Pick the Frequency. For anything but One-time, set the Next due date.",
          "Set the Status, tick Is this COGS? where it applies, then press Add payable.",
          "When a bill is actually paid, record it as an expense on Finance.",
        ],
        logic: [
          "Only Active payables count. Paused and Cancelled ones stay listed but count nowhere.",
          "Next due rolls forward by itself for recurring payables, so a monthly bill set up in January shows this month's date. The saved date is not changed.",
          "A row turns red when it is due within 7 days and Cash in Hand is less than 2 times the bill, by default.",
          "Payables feed break-even and Payables due this month. They never create an expense, so they do not change burn or profit.",
          "A euro bill reads in euros with the rupee value beneath. Totals are in rupees.",
        ],
        controls: [
          {
            setting: "Cash buffer that turns a bill due this week red",
            where: ["Sidebar", "Admin", "Founder Console", "Money", "Cash targets"],
            href: consoleHref("money", "cash-targets"),
            who: ["ADMIN"],
            default: "2 times the bill",
            effect: "Re-judges every payable straight away. No payable or expense is changed.",
          },
        ],
        watchOut: [
          "Delete removes a payable for good. To stop counting one but keep it, set its status to Paused or Cancelled.",
        ],
        shot: {
          file: "cash-payables.png",
          route: "/cash?tab=3",
          caption: "The Payables tab: fixed and one-time bills, soonest first.",
          highlight: { text: "Add payable", label: "Add a bill" },
        },
      },
    ],
    related: [
      { section: "finance", why: "Receivables come from Finance pending payments, burn from Finance expenses and this month's revenue from Finance income." },
      { section: "console", why: "The runway colours, burn window, revenue target and cash buffer are set in Console, Money, Cash targets." },
    ],
    faq: [
      {
        q: "Why is runway blank?",
        a: "Either no weekly bank balance has been entered yet, or there are no expenses recorded in the complete months the burn is averaged over.",
      },
      {
        q: "I recorded a big expense today. Why did runway not move?",
        a: "Burn only uses complete months, so this month's expenses count from the 1st of next month.",
      },
      {
        q: "Should I add money the owners put in to Cash in Hand?",
        a: "No. Record it on the Owner's equity tab. Cash in Hand is the bank balance, which already includes that money once it has arrived.",
      },
      {
        q: "I paid a bill on the Payables list. Why did nothing change?",
        a: "A payable is a commitment, not a payment. Record the payment as an expense on Finance; that is what counts in burn and profit.",
      },
    ],
  },

  // ───────────────────────────────────────── Bonus & Commission ─────────────────────────────────────────
  {
    section: "telecaller",
    overview:
      "The board where the founder assigns a bonus or commission to anyone on the team for a month, with the reason, and marks it paid. Amounts are typed here by hand, not calculated. Admins and head coaches can open it by default, but only someone with the right to approve rewards can change it.",
    features: [
      {
        id: "summary-cards",
        name: "Month and summary cards",
        where: ["Sidebar", "Finance", "Bonus & Commission", "Summary cards"],
        href: "/telecaller",
        what: "The month's totals: everything assigned, bonuses, commission, and what is not yet paid.",
        use: [
          "Pick a month in the box at the top right and press View.",
          "Tap a card to see the amount per person.",
        ],
        logic: [
          "Every figure is the sum of the bonuses and commission typed on this board for that month. Nothing is calculated from calls or from payments.",
          "Total assigned is bonus plus commission, in rupees with euros beneath, each entry valued at the rate stamped when it was created.",
          "Not yet paid is the entries still Pending. The line beneath it shows what is already Paid.",
          "The page opens on the current month unless you pick another.",
        ],
        shot: {
          file: "telecaller-summary-cards.png",
          route: "/telecaller",
          caption: "Bonus & Commission: the month's totals, each opening a per-person breakdown.",
          highlight: { text: "Total assigned", label: "The month's total" },
        },
      },
      {
        id: "the-team",
        name: "The team",
        where: ["Sidebar", "Finance", "Bonus & Commission", "The team"],
        href: "/telecaller",
        what: "One card per team member, with their call counts for the month as context for a reward.",
        use: [
          "Find the person's card.",
          "Press Assign to open the form below with that person already picked.",
        ],
        logic: [
          "Every active team member has a card, plus anyone who has left but was paid in the month shown, marked former.",
          "Appointment setters show Appointments, Leads contacted and Follow-up msgs. Discovery specialists show Disco calls, HQ calls and Follow-ups. Everyone else shows no counts.",
          "Call counts are added up from that person's daily logs for the month. They are context only and decide nothing.",
          "Assigned this month is that person's bonus and commission total for the month.",
        ],
        watchOut: [
          "A team member with no login linked to their profile always shows zero calls.",
        ],
        shot: {
          file: "telecaller-the-team.png",
          route: "/telecaller",
          caption: "The team cards, with this month's call counts where they are counted.",
          highlight: { text: "Assign", label: "Reward this person" },
        },
      },
      {
        id: "assign",
        name: "Assign bonus / commission",
        where: ["Sidebar", "Finance", "Bonus & Commission", "Assign bonus / commission"],
        href: "/telecaller",
        what: "Record a bonus, a commission or both for one person and one month, with the reason.",
        use: [
          "Pick the person under Telecaller and the Month the reward is for.",
          "Enter a bonus, a commission or both, in rupees, euros or both.",
          "Write the Reason / criteria, for example hit 40 appointments.",
          "Leave Status as Pending until the money has gone out, then press Assign payout.",
        ],
        logic: [
          "At least one amount is required, and a reason is always required.",
          "The exchange rate of the day the entry is created is stamped on it. Editing it later keeps that rate.",
          "The person list shows active team members only. A correction for someone who has left is made by editing their existing entry.",
          "Saving with Status Paid creates the matching expense on Finance straight away.",
        ],
        controls: [
          {
            setting: "Who can assign, edit, pay and delete rewards",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Per-person rules"],
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "Admin only",
            effect: "Takes effect on the person's next action. Entries already made are untouched.",
          },
          {
            setting: "Who can open Bonus & Commission",
            where: ["Sidebar", "Admin", "Founder Console", "Access", "Sections"],
            href: consoleHref("access", "sections"),
            who: ["ADMIN"],
            default: "Admins and head coaches",
            effect:
              "Giving another role access asks you to confirm first, because the page shows pay. Opening the page does not give the right to change it.",
          },
        ],
        shot: {
          file: "telecaller-assign.png",
          route: "/telecaller",
          caption: "The form for assigning a bonus or commission to one person for one month.",
          highlight: { text: "Assign payout", label: "Save the reward" },
        },
      },
      {
        id: "payouts",
        name: "Payouts",
        where: ["Sidebar", "Finance", "Bonus & Commission", "Payouts"],
        href: "/telecaller",
        what: "Every reward assigned for the month, and whether it has been paid.",
        use: [
          "Find the entry in the Payouts table.",
          "Click the status pill to switch it between Pending and Paid.",
          "Use Edit to change an entry, or Delete to remove it.",
        ],
        logic: [
          "Marking an entry Paid creates an expense on Finance under Team Salaries and Commissions, dated the 1st of the payout's month, shared between both businesses, paid from Bank - INR and linked to the person.",
          "That expense shows in Finance Team payments and in that month's profit. Its note says Auto-posted from a telecaller payout.",
          "Switching back to Pending, or deleting the entry, removes that expense again. Editing a Paid entry updates it.",
          "Delete removes the entry for good. There is no archive for payouts.",
        ],
        watchOut: [
          "This board does not read the Finance Commission tab. Commission worked out there has to be typed here to be paid.",
          "The next change made here overwrites any edit made to the matching expense on Finance, so change it here.",
          "Without the right to approve rewards, clicking the status pill or Delete still shows a confirmation message, but nothing changes.",
        ],
        shot: {
          file: "telecaller-payouts.png",
          route: "/telecaller",
          caption: "The month's payouts. The status pill switches an entry between Pending and Paid.",
          highlight: { text: "Payouts", label: "Every reward this month" },
        },
      },
    ],
    related: [
      { section: "finance", why: "A payout marked Paid becomes a team salary expense on Finance. The calculated deal-team split lives separately on Finance, Commission tab." },
      { section: "people", why: "The team cards come from team profiles, which are set up under Users." },
      { section: "console", why: "Who may approve rewards is set in Console, Access, Per-person rules." },
    ],
    faq: [
      {
        q: "Why does the commission here not match Finance, Commission?",
        a: "They are different things. Finance works commission out from student payments. This board only holds what has been assigned here by hand.",
      },
      {
        q: "I marked a payout Paid. Where is it on Finance?",
        a: "On the Expenses tab and in Team payments, dated the 1st of the payout's month, under Team Salaries and Commissions.",
      },
      {
        q: "Why can I not pick someone who has left?",
        a: "The person list shows the active team only. To correct a past month for them, edit the entry they already have.",
      },
      {
        q: "Why are a tutor's call counts empty?",
        a: "Call counts are only kept for appointment setters and discovery specialists. Everyone else can still be rewarded; their card just shows no counts.",
      },
    ],
  },
];
