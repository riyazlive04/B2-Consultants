import { consoleHref, type GuideManual } from "./manual-types";

/**
 * Founder Console manual. One feature per Console panel, in the Console's own order.
 * Every `logic` line is grounded in the panel, its server action, the config schema or the
 * engine that reads the setting. See the drafting report for what was left out as unconfirmed.
 */

const AREA = {
  access: "Access",
  money: "Money",
  sales: "Sales ops",
  delivery: "Delivery & team",
  system: "System",
} as const;

const W = (area: keyof typeof AREA, panel: string): string[] => [
  "Sidebar",
  "Admin",
  "Founder Console",
  AREA[area],
  panel,
];

export const MANUAL_CONSOLE: GuideManual[] = [
  {
    section: "console",
    overview:
      "The Founder Console is the one Admin-only screen where the app's rules live: who sees which screen, every money figure, how leads are routed and chased, how students and the team are run, and which automatic engines are switched on. Most other screens only follow the rules set here, so when a number or an automatic message looks wrong, the fix is usually a panel on this page. Every save is checked before it is stored and is written to the Activity Log.",
    engines: [
      "cron",
      "availability",
      "confirmLoop",
      "intake",
      "speedToLead",
      "dunning",
      "agreementReminders",
      "retention",
      "commissionAccrual",
      "tutorFeeAccrual",
      "invoicePosting",
      "autoCreateOpportunity",
    ],
    features: [
      // ───────────────────────────── Access ─────────────────────────────
      {
        id: "sections",
        name: "Sections",
        where: W("access", "Sections"),
        href: consoleHref("access", "sections"),
        what: "Decide which screens appear in the sidebar, what they are called, where they sit and which roles get them by default.",
        use: [
          "Open Founder Console, then Access, then Sections.",
          "Edit a row's label, icon or group, or use the arrows to move it up or down.",
          "Tick or untick a role column to change who gets that screen by default.",
          "Use the switch at the end of a row to turn a screen off for everyone.",
          "Press “Save changes”. The sidebar updates on the next page load.",
        ],
        logic: [
          "This list is each role's default. A per-person grant or block, set on that person's access dialog in Users, always wins over it.",
          "Admins see every screen that is switched on, whatever the role ticks say.",
          "Switching a screen off hides it and blocks its address for everyone, Admins included.",
          "Founder Console and Activity Log are locked: always on and Admin only. You can rename, re-icon or move them, but not hide them or give them to another role.",
          "Dashboard, My Journey and My Classroom are a student's own pages. Only the Student role can open them, so their other role boxes are greyed out.",
          "Six screens show company money: Finance, Cash Health, Payments, Bonus & Commission, Funnel Report and Users. Ticking a new non-Admin role on one of them opens a confirmation that names the role and the screen. Removing a role never asks.",
          "Every save is written to the Activity Log with the screens that changed.",
        ],
        controls: [
          {
            setting: "Sidebar layout and default role access for every screen",
            where: W("access", "Sections"),
            href: consoleHref("access", "sections"),
            who: ["ADMIN"],
            default: "The shipped layout: every screen on, each with the role list it was built with",
            effect:
              "Changes who can open a screen from their next page load. No records are touched, only access to them.",
            reset:
              "“Reset to defaults” puts every label, icon, order, group and role list back as soon as you confirm. Per-person overrides in Users are not touched.",
          },
        ],
        watchOut: [
          "Outreach ships off the sidebar but still open, because it is a tab on Pipeline. Any save on this panel puts it back on the sidebar, as the panel has no separate sidebar switch.",
          "Ticking a role on a money screen gives it to every current and future person in that role. To give one person access, use their access dialog in Users instead.",
          "The confirmation on money screens stops a mis-click. It is not an approval step.",
        ],
        shot: {
          file: "console-sections.png",
          route: consoleHref("access", "sections"),
          caption: "The Sections panel: one row per screen, with a column for each role's default access.",
          highlight: {
            text: "Rename, reorder, regroup, switch off, and set which roles see each section by default.",
            label: "Every screen, its group and its default roles",
          },
        },
      },
      {
        id: "access-matrix",
        name: "Access Matrix",
        where: W("access", "Access Matrix"),
        href: consoleHref("access", "access-matrix"),
        what: "A read-only check of what each role can open today, compared with the permission table in the rebuild spec.",
        use: [
          "Open Founder Console, then Access, then Access Matrix.",
          "Read the three counts at the top: granted beyond the spec, hidden despite the spec, and rules that cannot be expressed.",
          "Hover over a tick or cross to see why that cell is marked.",
          "To fix a cell, change the role default on the Sections tab, or one person's access in Users.",
        ],
        logic: [
          "It reads the same role defaults the Sections tab saves, through the same access rule the server uses.",
          "It checks role defaults only. Per-person grants and blocks set in Users are not shown here.",
          "A red tick means the app grants more than the spec. An amber cross means the spec grants something the app hides.",
          "A question mark means the spec gives different access to roles that share one role in this app, such as the three telecaller levels. Only a per-person override can satisfy that.",
          "A dot means the module is not controlled by a screen, so there is nothing to switch.",
        ],
        controls: [
          {
            setting: "The role defaults this matrix checks",
            where: W("access", "Sections"),
            href: consoleHref("access", "sections"),
            who: ["ADMIN"],
            effect:
              "Nothing can be changed on this tab. Edit Sections and the matrix re-checks on the next load.",
            reset: "Reset the role defaults from the Sections tab.",
          },
        ],
        watchOut: [
          "A person can still open a screen this matrix marks as hidden for their role, if they have a per-person grant in Users.",
        ],
        shot: {
          file: "console-access-matrix.png",
          route: consoleHref("access", "access-matrix"),
          caption: "The Access Matrix: each module against each role, checked against the spec.",
          highlight: { text: "Module access by role", label: "Who can open what, against the spec" },
        },
      },
      {
        id: "per-person",
        name: "Per-person rules",
        where: W("access", "Per-person rules"),
        href: consoleHref("access", "per-person"),
        what: "Switch individual permissions on or off for one person, on top of what their role allows.",
        use: [
          "Open Founder Console, then Access, then Per-person rules.",
          "Find the person's row in one of the three cards: Commission eligibility, Sales & pipeline, or Money & delivery.",
          "Flip the switch. It saves straight away; there is no Save button.",
          "Check the message that confirms Granted or Removed.",
        ],
        logic: [
          "A switch here beats the role default. Where nothing has been set for a person, their role's default applies.",
          "Admins hold every permission, so their rows are locked and cannot be changed.",
          "The three commission switches decide which legs of a deal split a person earns. By default Admins and Telecallers earn all three legs; every other role earns none.",
          "A person switched off a leg still appears on the commission report, marked not eligible, at zero.",
          "The commission report applies these switches each time it is worked out, so they also change past months you reopen. People who have left are treated as eligible, so their history is not rewritten.",
          "Only people with an active login are listed. The same switches exist one person at a time on the access dialog in Users.",
          "Each change is written to the Activity Log.",
        ],
        controls: [
          {
            setting: "One person's permissions and commission eligibility",
            where: W("access", "Per-person rules"),
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "No overrides: everyone holds exactly what their role grants",
            effect:
              "Applies straight away. Commission eligibility also re-values every month's report you open afterwards, but not payout runs already recorded.",
            reset: "There is no reset button. Flip the switch back by hand.",
          },
        ],
        watchOut: [
          "A Head coach or Coach who runs a call earns nothing for it until you switch the matching commission leg on for them here.",
          "Turning off a leg also lowers past months on the commission report, because the report is worked out fresh. Record the month's payout run first if you need it frozen.",
        ],
        shot: {
          file: "console-per-person.png",
          route: consoleHref("access", "per-person"),
          caption: "Per-person rules: a grid of people against the permissions worth setting one by one.",
          highlight: { text: "Commission eligibility", label: "Which commission legs each person earns" },
        },
      },

      // ───────────────────────────── Money ─────────────────────────────
      {
        id: "commission",
        name: "Commission",
        where: W("money", "Commission"),
        href: consoleHref("money", "commission"),
        what: "Set the percentages that split each student payment across the people who worked the deal.",
        use: [
          "Open Founder Console, then Money, then Commission.",
          "Type the four rates.",
          "Check the worked example on a ₹10,000 payment underneath.",
          "Press “Save changes”.",
        ],
        logic: [
          "Every rate is a percentage of money actually received, worked out on each payment. A part payment earns a part cut.",
          "One person who ran both the first call and the discovery call earns the both-calls rate. Two different people earn the split rate each. A lone first-call or discovery leg also earns the split rate.",
          "The closer who ran the sales call earns the closer rate on top of any earlier leg they had.",
          "When someone covers another person's discovery slot, that leg is divided: the stand-in keeps the substitute share and the slot's owner keeps the rest. It does not cost extra.",
          "The commission report in Finance, and each person's own commission on My Desk, read these rates every time they are opened.",
          "Decimals are allowed. Each rate must be between 0 and 100.",
        ],
        controls: [
          {
            setting: "Deal-team commission rates",
            where: W("money", "Commission"),
            href: consoleHref("money", "commission"),
            who: ["ADMIN"],
            default: "5% both calls, 3% split, 4% closer, 20% substitute share",
            effect:
              "Re-computed: the report for any month, past or present, uses the new rates the next time it opens. A payout run already recorded keeps the totals it saved.",
            reset: "“Reset to defaults” refills the shipped rates. Press “Save changes” to apply them.",
          },
        ],
        watchOut: [
          "Record the month's payout run (System, then Maintenance) before changing rates if you need that month's figures frozen.",
          "Who is eligible for each leg is set per person on Access, then Per-person rules, not here.",
        ],
        shot: {
          file: "console-commission.png",
          route: consoleHref("money", "commission"),
          caption: "The four commission rates, with a worked example on a ₹10,000 payment.",
          highlight: { text: "Both calls - one person (%)", label: "The rates every payment is split by" },
        },
      },
      {
        id: "instalment-plans",
        name: "Instalment Plans",
        where: W("money", "Instalment Plans"),
        href: consoleHref("money", "instalment-plans"),
        what: "Price paying in instalments, and set the default gap between instalment dates.",
        use: [
          "Open Founder Console, then Money, then Instalment Plans.",
          "Set “Days between instalments”.",
          "For each plan length, type the extra in rupees and in euros. Use “Add a plan length” for a new one.",
          "Use the preview to check the schedule a ₹1,50,000 fee produces.",
          "Press “Save changes”.",
        ],
        logic: [
          "The extra is added once to the agreed fee, not per instalment. A 3-part plan at ₹600 turns ₹1,50,000 into ₹1,50,600, split three ways.",
          "A plan length with no row, or a row at 0, adds nothing.",
          "Rupee and euro extras are separate, so a euro-billed student never inherits a rupee surcharge.",
          "The last instalment absorbs any rounding, so a schedule always adds up to the total.",
          "Finance reads this when you generate a schedule on Pending payments, and the gap can be changed per plan there. The new agreement form also pre-fills the surcharge from it.",
          "Plans can be 2 to 24 instalments, with one row per length.",
        ],
        controls: [
          {
            setting: "Instalment surcharge per plan length, and the default gap",
            where: W("money", "Instalment Plans"),
            href: consoleHref("money", "instalment-plans"),
            who: ["ADMIN"],
            default: "30 days between instalments. 3 instalments add ₹600. 2, 4 and 6 instalments add nothing.",
            effect:
              "Forward only. Each schedule stores its surcharge when it is generated, so plans already built keep their price.",
            reset: "“Reset to defaults” refills the shipped table. Press “Save changes” to apply it.",
          },
        ],
        watchOut: [
          "A receivable with no fee cannot be put on a plan, so a surcharge on its own never creates a schedule.",
        ],
        shot: {
          file: "console-instalment-plans.png",
          route: consoleHref("money", "instalment-plans"),
          caption: "Instalment plan pricing, with a preview of the schedule a real fee produces.",
          highlight: { text: "Extra amount per plan length", label: "What each plan length adds to the fee" },
        },
      },
      {
        id: "payment-types",
        name: "Payment Types",
        where: W("money", "Payment Types"),
        href: consoleHref("money", "payment-types"),
        what: "The list of payment types every money form offers, and how each one behaves.",
        use: [
          "Open Founder Console, then Money, then Payment Types.",
          "Rename a type in its Name box, or switch Offered off to stop offering it.",
          "Press “Add a payment type”, name it and pick its kind.",
          "Press “Save changes”.",
        ],
        logic: [
          "The kind decides behaviour. Paid in full asks for nothing more. Instalment plan asks for a count and a schedule, raises a receivable and is chased. Recurring asks for an interval and a next date, and raises no receivable.",
          "A new type's code is made from the first name you give it and never changes after that.",
          "Full payment and Instalment are locked. Every past income record uses one of them, so they can be renamed or switched off but never removed or given another kind.",
          "At least one type must stay offered, and the list holds up to 24.",
          "Names are read live, so a rename shows on every screen, including old records.",
          "A switched-off type still shows on records that already use it, marked as no longer offered.",
        ],
        controls: [
          {
            setting: "Payment types offered on money forms",
            where: W("money", "Payment Types"),
            href: consoleHref("money", "payment-types"),
            who: ["ADMIN"],
            default: "Full payment, Instalment and Subscription, all offered",
            effect:
              "Renames apply everywhere at once. Switching a type off only stops it being offered. Changing the kind of a type you added changes how its existing records are treated.",
            reset: "“Reset to defaults” refills the shipped three. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "Removing a type you added makes its old records show the raw code and be treated as paid in full. Switch it off instead.",
          "Do not record a subscription as an instalment plan. The chasing ladder would treat it as a debt.",
        ],
        shot: {
          file: "console-payment-types.png",
          route: consoleHref("money", "payment-types"),
          caption: "The payment types list: name, code, kind and whether each is offered.",
          highlight: { text: "Add a payment type", label: "Add a new kind of payment" },
        },
      },
      {
        id: "expense-categories",
        name: "Expense categories",
        where: W("money", "Expense categories"),
        href: consoleHref("money", "expense-categories"),
        what: "The list of cost categories, and which P&L line each one posts to in the ledger.",
        use: [
          "Open Founder Console, then Money, then Expense categories.",
          "Rename a category, choose its P&L line, tick COGS if it is usually a direct delivery cost, and switch Offered on or off.",
          "Press “Add an expense category”. Leave its P&L line on “+ Its own new line” to give it a line of its own, or pick an existing line.",
          "Press “Save changes”.",
        ],
        logic: [
          "Each category debits one P&L line in the ledger. That is what makes it a line in the accounts rather than just a label.",
          "Choosing its own new line creates a new expense account in the ledger when you save. Renaming that category later renames its line too.",
          "COGS is only the default tick for a new cost. Every cost still carries its own tick.",
          "Team Salaries, COGS - Direct Delivery Cost and Other cannot be removed. The app relies on them by name for team pay, approved tutor fees and costs it does not recognise.",
          "The list is offered on the expense form, the Record button and the payables list. At least one category must stay offered, up to 40 in all.",
        ],
        controls: [
          {
            setting: "Expense categories and their P&L lines",
            where: W("money", "Expense categories"),
            href: consoleHref("money", "expense-categories"),
            who: ["ADMIN"],
            default:
              "The shipped eight: Marketing, Tools and Software, Team Salaries and Commissions, Content Creation, Events and Offline, Operations, COGS - Direct Delivery Cost, Other",
            effect:
              "Costs already in the books stay on the line they were posted to. New costs use the new line. A cost posted again later, for example one restored from the archive, lands on the category's current line.",
            reset:
              "“Back to the shipped eight” refills the list. Press “Save changes” to apply. P&L lines already created stay in the ledger.",
          },
        ],
        watchOut: [
          "A new P&L line cannot be deleted from this panel. If you are unsure, point the category at an existing line.",
          "Removing a category you added makes its old costs read as Other. Switch it off instead.",
        ],
        shot: {
          file: "console-expense-categories.png",
          route: consoleHref("money", "expense-categories"),
          caption: "Expense categories, each pointed at the P&L line its costs are debited to.",
          highlight: { text: "Add an expense category", label: "Add a cost category or a new P&L line" },
        },
      },
      {
        id: "invoicing",
        name: "Invoicing",
        where: W("money", "Invoicing"),
        href: consoleHref("money", "invoicing"),
        what: "Who invoices are from, and the tax each currency charges by default.",
        use: [
          "Open Founder Console, then Money, then Invoicing.",
          "Fill in “Who the invoice is from”: trading name, owner's legal name, address, contact details, Tax ID, bank details and standing terms.",
          "Under Tax, set what the tax is called and its rate for rupee and for euro invoices.",
          "If a rate is 0, type the reason no tax is charged in the box beside it.",
          "Press “Save changes”.",
        ],
        logic: [
          "The issuer block is read when a document is printed, so a correction shows on invoices already issued too.",
          "Blank fields are left off the document. Nothing is invented.",
          "The tax rate is only the starting point for a new invoice. Each invoice keeps the name and rate it charged, and can be changed before it is issued.",
          "A rate of 0 prints no tax line. The invoice must then carry the reason note.",
          "An invoice cannot be issued until the owner's legal name, the full business address and the Tax ID are filled in, and a 0% invoice has its reason note.",
          "Rates can have decimals, from 0 to 100.",
        ],
        controls: [
          {
            setting: "Invoice issuer details and default tax per currency",
            where: W("money", "Invoicing"),
            href: consoleHref("money", "invoicing"),
            who: ["ADMIN"],
            default:
              "Name, owner, address, email, phone, website and bank details pre-filled from the agreement's party details. Tax ID blank. GST 0% on rupee invoices, VAT 0% on euro invoices.",
            effect:
              "Issuer details change every document, including issued ones. Tax rates apply only to new invoices; sent invoices keep what they charged.",
            reset: "“Reset to defaults” refills the shipped details. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "Which reason applies at 0% is for your tax adviser to confirm.",
          "Because issuer details reach old invoices too, do not use them to change what an earlier invoice said.",
        ],
        shot: {
          file: "console-invoicing.png",
          route: consoleHref("money", "invoicing"),
          caption: "Invoicing: the issuer block printed on every invoice, and the tax per currency.",
          highlight: { text: "Who the invoice is from", label: "Required before an invoice can be issued" },
        },
      },
      {
        id: "cash-targets",
        name: "Cash targets",
        where: W("money", "Cash targets"),
        href: consoleHref("money", "cash-targets"),
        what: "The bars Cash Health judges your cash against.",
        use: [
          "Open Founder Console, then Money, then Cash targets.",
          "Set the monthly revenue target in rupees.",
          "Set the green and amber runway months, and the gauge horizon.",
          "Set the burn averaging window and the minimum cash buffer.",
          "Check the “How a runway would read” row, then press “Save changes”.",
        ],
        logic: [
          "Runway is cash divided by the average monthly spend over the burn window. Months with no expenses recorded are skipped.",
          "Runway at or above green reads green, at or above amber reads amber, below amber reads red.",
          "Green must be at or above amber. The panel will not save otherwise.",
          "The gauge horizon only sets what a full dial means. It changes no verdict.",
          "A payable due within 7 days turns red when cash in hand is below the buffer times the bill.",
          "A revenue target of 0 hides the months-to-target verdict rather than calling it reached.",
          "Read by Cash Health, the home page figures and the runway pill in the top bar.",
        ],
        controls: [
          {
            setting: "Revenue target, runway bands, burn window and payable buffer",
            where: W("money", "Cash targets"),
            href: consoleHref("money", "cash-targets"),
            who: ["ADMIN"],
            default:
              "₹8,00,000 a month. Green at 6 months or more, amber at 3. Gauge of 12 months. Buffer of 2 times the bill. Burn averaged over 3 months.",
            effect:
              "No recorded figure changes. Every cash verdict is re-judged against the new bars the next time a page loads.",
            reset: "“Reset to shipped defaults” refills the shipped bars. Press “Save changes” to apply.",
          },
        ],
        shot: {
          file: "console-cash-targets.png",
          route: consoleHref("money", "cash-targets"),
          caption: "Cash targets: the revenue goal, the runway bands with a live preview, and the burn window.",
          highlight: { text: "Runway verdict", label: "When runway reads green, amber or red" },
        },
      },
      {
        id: "tutor-fee",
        name: "Tutor Fee",
        where: W("money", "Tutor Fee"),
        href: consoleHref("money", "tutor-fee"),
        what: "The rate bands that price what a tutor earns for running a German batch.",
        use: [
          "Open Founder Console, then Money, then Tutor Fee.",
          "Set the threshold: how many students a batch needs for the lower rate.",
          "For A1, A2 and B1, type the per-head rate at or above the threshold, and below it.",
          "Check the preview of what an A1 batch costs at each size.",
          "Press “Save changes”.",
        ],
        logic: [
          "The rate depends on batch size, not level. At or above the threshold a batch pays the lower volume rate; below it, the higher thin-batch rate.",
          "The fee is charged per student. A 5-student batch at ₹7,000 costs ₹35,000.",
          "Only A1, A2 and B1 are priced. Other levels carry no tutor fee.",
          "Rates are whole rupees.",
          "German Note's batch costs read these bands live, from each batch's current headcount.",
          "The Tutor Fees ledger next door only picks up new bands when you press “Recompute from rosters”.",
        ],
        controls: [
          {
            setting: "Tutor fee threshold and per-head rates by level",
            where: W("money", "Tutor Fee"),
            href: consoleHref("money", "tutor-fee"),
            who: ["ADMIN"],
            default: "Threshold of 5 students. ₹7,000 per head at 5 or more, ₹8,000 per head below 5, for every level.",
            effect:
              "Batch cost views change at once. Draft fees change only when you recompute. Approved and paid fees never change.",
            reset: "“Reset to defaults” refills the shipped bands. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "These bands are separate from the per-sale delivery cost used in German Note workshop profit, so changing them does not restate workshop profit.",
        ],
        shot: {
          file: "console-tutor-fee.png",
          route: consoleHref("money", "tutor-fee"),
          caption: "Tutor fee bands, with what an A1 batch costs at each size.",
          highlight: {
            text: "Threshold - students needed for the lower rate",
            label: "Where the rate steps down",
          },
        },
      },
      {
        id: "tutor-fees",
        name: "Tutor Fees",
        where: W("money", "Tutor Fees"),
        href: consoleHref("money", "tutor-fees"),
        what: "What each German batch owes its trainer right now, and where each fee is in the approval steps.",
        use: [
          "Open Founder Console, then Money, then Tutor Fees. The number on the tab counts draft fees.",
          "Press “Recompute from rosters” to create or update draft fees from today's batch sizes.",
          "Check each row's band and amount. Use “Override” to change a draft amount; a reason is required.",
          "Press “Approve” to freeze a fee, then “Mark paid” once the trainer is paid.",
          "Use “Cancel” to withdraw a draft or approved fee.",
        ],
        logic: [
          "Recompute only touches drafts. Approved, paid and cancelled fees stay frozen, and the message says how many were left alone.",
          "Approving freezes the fee. A student joining later does not re-price it; the row notes that the roster has moved.",
          "A draft whose roster has changed is flagged for recompute.",
          "The amount owed is the override when one is set, otherwise the computed figure.",
          "Each row also shows how many students actually attend on average, for information only. The fee is still priced on the roster.",
          "Approving posts the fee to the ledger as money owed only when the tutor-fee posting switch is on. It ships off.",
          "The totals at the top add up draft, approved and paid fees.",
        ],
        controls: [
          {
            setting: "The tutor fee record: recompute, override, approve, pay or cancel",
            where: W("money", "Tutor Fees"),
            href: consoleHref("money", "tutor-fees"),
            who: ["ADMIN"],
            default: "No fees until you recompute",
            effect:
              "Recompute rewrites drafts from current rosters and bands. Approved and paid fees never change.",
            reset: "There is no reset. Cancel a fee you do not want.",
          },
        ],
        watchOut: [
          "The switch that posts approved fees to the ledger is not on any screen yet. The hint on this tab and the Not armed list point elsewhere, but neither Operations nor Maintenance shows it. So approving records the decision only.",
          "“Mark paid” does not record the payment in Finance. Record the expense there as well.",
        ],
        shot: {
          file: "console-tutor-fees.png",
          route: consoleHref("money", "tutor-fees"),
          caption: "The tutor fee record: each batch's fee, its band and its approval status.",
          highlight: { text: "Recompute from rosters", label: "Refresh draft fees from today's batches" },
        },
      },

      // ───────────────────────────── Sales ops ─────────────────────────────
      {
        id: "qualification",
        name: "Qualification",
        where: W("sales", "Qualification"),
        href: consoleHref("sales", "qualification"),
        what: "The qualification questions, how each answer scores, and which scorer decides the booking verdict.",
        use: [
          "Open Founder Console, then Sales ops, then Qualification.",
          "Read the banner first. It says whether these questions are live, ready, or blocked.",
          "Use “Add question”, or “Edit” on a question, to change its wording, dimension, weight and answers. Answers go one per line as answer text | score from 0 to 4.",
          "Open “Advanced: landing-page wording” to add the field names and answer wordings an outside form uses.",
          "Check the landing page card for answers that are not being recognised.",
          "Press “Make these questions live” once it is allowed, or “Revert to shipped scoring” to go back.",
        ],
        logic: [
          "A dimension takes the best answer it has, not the sum.",
          "The booking form scores with the original built-in tables until you make these questions live. Switching is only allowed when these questions reproduce every past booking's verdict exactly. Going back is always allowed.",
          "Leads arriving from the landing page are always scored with these questions, whichever scorer the booking form uses.",
          "Changing the wording, kind, dimension, weight or answers of a question that already has answers creates a new version and retires the old one. Past answers keep pointing at the version they were given against.",
          "Changing only the landing-page field names or answer wordings updates the question in place.",
          "“Retire” hides a question; it is never deleted. “Restore” brings it back.",
          "Once these questions are live, with auto-disqualify on, a change here changes who is turned away at booking.",
        ],
        controls: [
          {
            setting: "Qualification questions and the live scorer",
            where: W("sales", "Qualification"),
            href: consoleHref("sales", "qualification"),
            who: ["ADMIN"],
            default: "The built-in tables decide the booking verdict; the question list is whatever was set up at install",
            effect:
              "Forward only. New bookings and new opt-ins are scored with the current questions. Leads and bookings already scored keep their score.",
            reset:
              "“Revert to shipped scoring” switches the booking form back at once. Questions have no reset; edit or retire them.",
          },
        ],
        watchOut: [
          "If leads are arriving but none has been scored in 7 days, the field names do not match the outside form. The panel says so in red.",
          "An answer that matches a question but no option scores too low. Add its wording against the option it means.",
        ],
        shot: {
          file: "console-qualification.png",
          route: consoleHref("sales", "qualification"),
          caption: "The qualification questions, the live-scorer banner and what the landing page is sending.",
          highlight: { text: "Add question", label: "Add or edit a scored question" },
        },
      },
      {
        id: "call-distribution",
        name: "Call Distribution",
        where: W("sales", "Call Distribution"),
        href: consoleHref("sales", "call-distribution"),
        what: "Who gets new leads, how many are handed out automatically, how call-backs are chased, and which lead comes first.",
        use: [
          "Open Founder Console, then Sales ops, then Call Distribution.",
          "Set the auto-assigned share: 100 gives every new lead an owner, 0 leaves them all for hand-out.",
          "Type each person's share and check the “of the next 100” figure beside it.",
          "Set the fairness window, the daily cap, and whether “Hand out leads” splits by share.",
          "Set the call-back wait, how many call-backs before giving up, and the two switches for when the chase ends.",
          "Adjust the ranking points, then press “Save changes”.",
        ],
        logic: [
          "Shares are relative weights. They need not total 100; the split that runs is the one shown beside each name.",
          "A share of 0 takes a person out of the rotation. Only active people with a login are listed.",
          "Each share is stored on the person's team profile, so it is the same number as the share on their profile in Users.",
          "The auto-assigned share is a rate the engine works towards over the fairness window. Held-back leads arrive unowned and wait for Pipeline, Leads, “Hand out leads”.",
          "The daily cap stops automatic assignment to a person for the rest of the day. 0 means no cap.",
          "The ranking points apply to both a caller's own queue and the Pipeline's call-first list.",
          "After a call is logged, a lead rests for the set hours on the opted-in, old-lead and workshop lists. Leads still inside their same-day connection deadline are not rested.",
          "Every save is logged, with each share change named.",
        ],
        controls: [
          {
            setting: "Lead rotation, call-back chase and lead ranking",
            where: W("sales", "Call Distribution"),
            href: consoleHref("sales", "call-distribution"),
            who: ["ADMIN"],
            default:
              "Every new lead auto-assigned. Fairness window 30 days. No daily cap. Hand-out to one person. Rest 24 hours. Call back every 4 hours, 3 times, then file the card under Cancelled/Unqualified and WhatsApp the prospect. Ranking: 10 per BANT point, 15 highly-qualified bonus, 10 freshness bonus for 7 days, idle penalty 1 a day after 7 days, capped at 20.",
            effect:
              "Applies to leads arriving and hand-outs made after you save. Leads that already have an owner keep it. Queues re-rank the next time a desk or Pipeline loads.",
            reset:
              "“Reset to defaults” refills the shipped rules but keeps the saved shares. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "The end-of-chase WhatsApp ships on and goes out with nobody pressing send, once its template is bound in WhatsApp settings. Someone who said not interested or gave a wrong number is never messaged.",
          "With “Hand out leads by share, not to one person” off, your shares only govern new arrivals, not the backlog.",
        ],
        shot: {
          file: "console-call-distribution.png",
          route: consoleHref("sales", "call-distribution"),
          caption: "Call distribution: auto-assignment, each person's share, call-backs and ranking.",
          highlight: {
            text: "Hand out leads by share, not to one person",
            label: "Whether the backlog follows the shares",
          },
        },
      },
      {
        id: "availability",
        name: "Availability",
        where: W("sales", "Availability"),
        href: consoleHref("sales", "availability"),
        what: "The weekly availability patterns that keep the booking calendars stocked with open slots.",
        use: [
          "Open Founder Console, then Sales ops, then Availability.",
          "Under Discovery calls, press “Add a calendar”, name it and choose whose calendar it is.",
          "Pick the days, the first slot start, the closing time, minutes between starts, call length and how many days ahead to keep stocked.",
          "Read “What this produces” to check the pattern actually makes slots.",
          "Switch on “Keep this calendar stocked automatically” and press “Save changes”.",
          "For your own sales calls, do the same in the SSS diary section below.",
        ],
        logic: [
          "An hourly job replays every live calendar and creates any missing open slot inside its horizon. It never edits or deletes a booked or blocked slot.",
          "A funnel booking page shows only its own owner's times. An unassigned calendar feeds the shared booking page.",
          "Times are India time.",
          "The horizon is capped at how far ahead someone may book, and the booking buffer is added between slots. Both are set on Bookings, Manage availability.",
          "A calendar that is on must have at least one day. Two live calendars cannot share an owner. Up to 12 calendars.",
          "The SSS diary needs an SSS owner set on Bookings first, and its call length comes from there too.",
          "Until at least one calendar is on with a day selected, availability counts as not armed and booking pages show an empty calendar.",
        ],
        controls: [
          {
            setting: "Standing weekly availability per person, and the SSS diary",
            where: W("sales", "Availability"),
            href: consoleHref("sales", "availability"),
            who: ["ADMIN"],
            default:
              "No calendars, and the SSS diary off. A new calendar starts Monday to Friday, 3:00 PM to 6:00 PM, every 30 minutes, 30-minute calls, 21 days ahead.",
            effect:
              "Adds open slots on the next hourly run. Switching a calendar off or removing it stops new slots, but open slots it already made stay bookable.",
            reset:
              "Under Discovery calls, “Reset to defaults” only undoes unsaved edits. In the SSS diary it refills the shipped pattern, which is off. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "To clear slots already created, block or delete them on Bookings.",
          "Nothing is created unless the scheduled jobs are running.",
        ],
        shot: {
          file: "console-availability.png",
          route: consoleHref("sales", "availability"),
          caption: "Availability: one weekly pattern per person, with a count of the slots it produces.",
          highlight: {
            text: "Discovery calls - one calendar per person",
            label: "Each person's standing weekly hours",
          },
        },
      },
      {
        id: "zoom",
        name: "Zoom links",
        where: W("sales", "Zoom links"),
        href: consoleHref("sales", "zoom"),
        what: "Which Zoom login hosts each person's booked calls.",
        use: [
          "Open Founder Console, then Sales ops, then Zoom links.",
          "Read the status card: Armed, Misconfigured or Off.",
          "Type each person's Zoom login email, or leave it blank to use the account owner.",
          "Fill in “Everyone else / unassigned slots” if unassigned calls should run from a particular login.",
          "Press “Save changes”.",
        ],
        logic: [
          "Only the mapping is set here. Turning Zoom on, and its credentials, are server settings that need a deploy.",
          "When armed, a new booking gets a Zoom meeting and link, a reschedule moves it, and a cancellation deletes it.",
          "An unmapped person falls back to the default login, and a blank default falls back to the Zoom account owner. Every call still gets a link.",
          "Emails are not checked against Zoom. A typo shows up as a failed meeting on the next booking.",
          "The panel warns when two people resolve to the same login, because overlapping calls would share one room.",
        ],
        controls: [
          {
            setting: "Zoom host login per person",
            where: W("sales", "Zoom links"),
            href: consoleHref("sales", "zoom"),
            who: ["ADMIN"],
            default: "No mappings: every call is hosted by the Zoom account owner. Zoom itself is off until the server setting is on.",
            effect: "Used when a meeting is next created. Meetings already created keep their host.",
            reset: "There is no reset button. Clear the boxes and save to fall back to the account owner.",
          },
        ],
        shot: {
          file: "console-zoom.png",
          route: consoleHref("sales", "zoom"),
          caption: "Zoom links: whether Zoom is armed, and which login hosts each person's calls.",
          highlight: { text: "Everyone else / unassigned slots", label: "The fallback host" },
        },
      },
      {
        id: "confirm-loop",
        name: "Confirm-or-cancel",
        where: W("sales", "Confirm-or-cancel"),
        href: consoleHref("sales", "confirm-loop"),
        what: "Ask booked prospects to confirm on WhatsApp, and release the slot if they never answer.",
        use: [
          "Open Founder Console, then Sales ops, then Confirm-or-cancel.",
          "Set when to ask, when to release the slot, and the minimum time to reply. Type 3h, 45m or 1h30m; a bare number means hours.",
          "Read the sentence under the boxes. It states the rule exactly as it will run.",
          "Switch on “Ask for confirmation, and release the slot if nobody answers”, and choose whether the next call moves up.",
          "Press “Save changes”. Use “Run the loop now” to run it at once instead of waiting.",
        ],
        logic: [
          "While a prospect has not confirmed, the slot is held for them. A WhatsApp yes confirms it, and so does Mark confirmed on Bookings, Booking requests.",
          "The ask time must be longer than the release time, unless ask is 0, which means never ask and never release.",
          "The reply time counts from when the request went out and is at least 5 minutes, so a short-notice booking is never cancelled unanswered.",
          "Moving the next call up works on any cancellation, including one made by hand, even with the main switch off. It moves the same caller's next call that day, of the same length.",
          "If the app cannot show the prospect was ever asked, it does not release the slot.",
          "It runs every minute on the scheduled jobs. “Slots released” lists the latest releases; the full list is on Bookings, Cancelled slots.",
          "This one rule has three doors: this panel, WhatsApp settings and Bookings, Manage availability. A save on any of them changes it for all.",
          "A duration the panel cannot read keeps the stored value instead of resetting it.",
        ],
        controls: [
          {
            setting: "Confirm-or-cancel switch, timings and move-up",
            where: W("sales", "Confirm-or-cancel"),
            href: consoleHref("sales", "confirm-loop"),
            who: ["ADMIN", "HEAD", "USER"],
            default: "Off. Ask 24 hours before, release 3 hours before, at least 30 minutes to reply, move the next call up on.",
            effect:
              "Applies to bookings already on the calendar from the next run. A released call is cancelled and the prospect is told.",
            reset: "There is no reset button. Type the default values back and save.",
          },
        ],
        watchOut: [
          "This is the only automation that cancels a real prospect's call. Switch it on only once the confirmation template is approved and WhatsApp is sending.",
          "Anyone who can open Bookings can change this rule from Bookings, Manage availability, not only Admins.",
        ],
        shot: {
          file: "console-confirm-loop.png",
          route: consoleHref("sales", "confirm-loop"),
          caption: "Confirm-or-cancel: the switch, the three timings, the rule read back, and recent releases.",
          highlight: {
            text: "Ask for confirmation, and release the slot if nobody answers",
            label: "The switch that can cancel real calls",
          },
        },
      },
      {
        id: "operations",
        name: "Operations",
        where: W("sales", "Operations"),
        href: consoleHref("sales", "operations"),
        what: "When a student's books are ordered, and how cards move on the Pipeline and Deals boards.",
        use: [
          "Open Founder Console, then Sales ops, then Operations.",
          "Set the order threshold in rupees collected, and check the “What happens at each amount paid” list.",
          "Press “Save changes” in the book-order card.",
          "In the pipeline card, choose the Pipeline mode and whether every new lead goes on the Deals board.",
          "Press “Save changes” in the pipeline card.",
        ],
        logic: [
          "A book order is placed straight away when the student has paid at least the threshold in total. Below it the order is held, with the shortfall shown.",
          "The rule reads cash actually collected, not the payment plan.",
          "Rules-driven mode places cards by the stage rules, and they cannot be dragged. Drag-and-drop lets the team move cards by hand; a moved card stays put and the rules stop correcting it.",
          "Pipeline and the Deals board read the mode on every load.",
          "With new leads on the board, each captured lead gets a card at zero value in the column for its stage.",
          "The two cards save separately.",
        ],
        controls: [
          {
            setting: "Book-order threshold, pipeline mode and new-lead cards",
            where: W("sales", "Operations"),
            href: consoleHref("sales", "operations"),
            who: ["ADMIN"],
            default:
              "₹30,000 threshold. Fresh quotation before each level on. Rules-driven pipeline. Every new lead on the Deals board.",
            effect:
              "The threshold is applied when a book order is created; orders already placed or held do not change. The mode changes the boards at once. New-lead cards are made only for leads captured after the switch is on.",
            reset: "Each card's “Reset to defaults” refills its shipped values. Press that card's “Save changes”.",
          },
        ],
        watchOut: [
          "“Take a fresh quotation before each level” is saved, but nothing in the app acts on it yet.",
          "Changing only “Put every new lead on the Deals board” does not enable “Save changes”. To save it, change the mode as well and save, then set the mode back and save again.",
          "A held book order is not released by itself when the student pays more. Move it on by hand from the book orders list.",
        ],
        shot: {
          file: "console-operations.png",
          route: consoleHref("sales", "operations"),
          caption: "Operations: the book-order threshold, and how the pipeline boards are driven.",
          highlight: { text: "Put every new lead on the Deals board", label: "Auto-filing new leads onto the board" },
        },
      },
      {
        id: "lead-webhook",
        name: "Lead Webhook",
        where: W("sales", "Lead Webhook"),
        href: consoleHref("sales", "lead-webhook"),
        what: "One switch that lets pages hosted outside this app send their leads in.",
        use: [
          "Open Founder Console, then Sales ops, then Lead Webhook.",
          "Switch on “Accept leads from the B2 Consultants webhook” and confirm.",
          "Press “Copy” and paste the URL into the outside form's webhook setting.",
          "Send a test submission and check “Last delivery”.",
          "Press “New key” if the URL ever leaks.",
        ],
        logic: [
          "Off, the webhook refuses every delivery. Our own pages and forms bring in leads either way.",
          "The first switch-on creates the secret key that is part of the URL.",
          "The switch is read fresh on every delivery, so switching off stops leads on the very next one.",
          "A delivered lead is created, assigned to a caller and started on the outreach sequence, including the instant WhatsApp intro if outreach is armed.",
          "The outside form must send a name and a phone number.",
          "Every switch and key change is logged.",
        ],
        controls: [
          {
            setting: "Accept leads from outside pages",
            where: W("sales", "Lead Webhook"),
            href: consoleHref("sales", "lead-webhook"),
            who: ["ADMIN"],
            default: "Off, with no key",
            effect: "Affects deliveries from now on. Leads already captured are untouched.",
            reset: "Switch it off. “New key” stops the old URL working at once.",
          },
        ],
        watchOut: [
          "Treat the URL like a password. Anyone who has it can add leads.",
          "After a new key, every outside page must be updated, or its leads are refused.",
          "The lead capture row on Not armed turns green once any lead route has received a delivery, not only this one.",
        ],
        shot: {
          file: "console-lead-webhook.png",
          route: consoleHref("sales", "lead-webhook"),
          caption: "The lead webhook switch, its URL and the last delivery.",
          highlight: {
            text: "Accept leads from the B2 Consultants webhook",
            label: "Let outside pages send leads in",
          },
        },
      },

      // ───────────────────────────── Delivery & team ─────────────────────────────
      {
        id: "agreements",
        name: "Agreements",
        where: W("delivery", "Agreements"),
        href: consoleHref("delivery", "agreements"),
        what: "When an agreement is prompted as ready to send, how signing links go out, how long they last and when unsigned ones are chased.",
        use: [
          "Open Founder Console, then Delivery & team, then Agreements.",
          "Pick when to prompt: as soon as they've agreed, once the deposit is paid, or only when the deal is won.",
          "Choose how the signing link is sent, the signing window in days, and the reminder days.",
          "Press “Save changes”. Either card's button saves all of these settings together.",
        ],
        logic: [
          "Readiness is only a prompt. It decides who gets the ready-to-send card on a contact and the task on your dashboard. You can always send an agreement to anyone.",
          "Sending by both tries WhatsApp and email and reports each. WhatsApp needs an approved template and a number that has not opted out.",
          "The signing window is stamped on a link when it is sent. After it, an unsigned agreement must be voided and cloned.",
          "A daily sweep chases unsigned, unexpired agreements on the chosen days after sending, up to five days. A day already sent is never sent again, and nothing goes out after the link expires.",
          "Reminders carry no link. They point the person to the message they already have.",
          "Turning every reminder day off stops chasing.",
        ],
        controls: [
          {
            setting: "Agreement prompt, delivery channel, signing window and reminder days",
            where: W("delivery", "Agreements"),
            href: consoleHref("delivery", "agreements"),
            who: ["ADMIN"],
            default:
              "Prompt as soon as they've agreed. Send by WhatsApp and email. 14-day signing window. Reminders on days 3, 7 and 12.",
            effect:
              "Prompts re-check on the next view. The signing window applies to links sent after the change; links already out keep their expiry. Reminder days apply to agreements already out, from the next daily sweep.",
            reset: "“Reset to defaults” refills all four settings. Press “Save changes” to apply.",
          },
        ],
        watchOut: [
          "Chasing is on by default, but it only runs if the scheduled jobs are running.",
          "The document that one-tap send uses is chosen where agreement templates are managed, not here.",
        ],
        shot: {
          file: "console-agreements.png",
          route: consoleHref("delivery", "agreements"),
          caption: "Agreement settings: when to prompt, how links are sent, how long they last and when to chase.",
          highlight: { text: "Chase an unsigned agreement", label: "The reminder days" },
        },
      },
      {
        id: "delivery-defaults",
        name: "Delivery defaults",
        where: W("delivery", "Delivery defaults"),
        href: consoleHref("delivery", "delivery-defaults"),
        what: "The coach a new enrolment gets when nobody picks one.",
        use: [
          "Open Founder Console, then Delivery & team, then Delivery defaults.",
          "Type the coach's name, or leave the box blank.",
          "Press “Save changes”.",
        ],
        logic: [
          "Used when someone creates an enrolment and leaves the coach empty. It is also pre-selected in the coach picker.",
          "It is a name, not a link to a login.",
          "The enrolment welcome names the student's tutor and falls back to this coach when the batch has no tutor, so this name can reach students.",
          "Blank leaves new enrolments unassigned. Names are kept under 120 characters.",
        ],
        controls: [
          {
            setting: "Default coach for new enrolments",
            where: W("delivery", "Delivery defaults"),
            href: consoleHref("delivery", "delivery-defaults"),
            who: ["ADMIN"],
            default: "Blank",
            effect: "Forward only. Enrolments already created keep their coach.",
            reset: "“Reset to defaults” here only undoes unsaved typing. Clear the box and save to go back to blank.",
          },
        ],
        shot: {
          file: "console-delivery-defaults.png",
          route: consoleHref("delivery", "delivery-defaults"),
          caption: "The default coach used when an enrolment is created without one.",
          highlight: { text: "Default coach", label: "Can reach students in the welcome message" },
        },
      },
      {
        id: "daily-targets",
        name: "Daily Targets",
        where: W("delivery", "Daily Targets"),
        href: consoleHref("delivery", "daily-targets"),
        what: "The daily targets that grade every Daily Log entry, and the end-of-day rules for logging.",
        use: [
          "Open Founder Console, then Delivery & team, then Daily Targets.",
          "Set each role's daily target. Use 0 to grade against the person's own recent average.",
          "Press “Save changes” in the targets card.",
          "In the end-of-day card, set the reminder time, the cutoff and the amend window, and the auto-save and summary switches.",
          "Switch on “Enforce end-of-day rules” and press “Save changes”.",
        ],
        logic: [
          "Hitting the target reads On target, well over reads Standout, well under reads Below par.",
          "Targets are read each time the log and the team board load, so past days are re-graded too.",
          "A log is always stamped with today's date, so the day already locks at midnight India time.",
          "With the end-of-day rules on: from the reminder time an unlogged person is nudged; after the cutoff no new log can be started for today; at the cutoff, auto-save writes a log from recorded activity for anyone who did not log; and Admin gets a summary of who logged.",
          "An auto-saved log stays editable by its owner for the amend window. 0 makes it final.",
          "The reminder must be before the cutoff. The panel will not save otherwise.",
          "Auto-save needs the scheduled jobs. The reminder and the cutoff read the real clock and work without them.",
        ],
        controls: [
          {
            setting: "Daily targets per role, and the end-of-day rules",
            where: W("delivery", "Daily Targets"),
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default:
              "Targets: 5 discovery calls, 3 appointments, 4 sessions a day. End-of-day rules off; reminder 6:00 PM, cutoff 9:00 PM, amend window 1 day, auto-save on, summary on.",
            effect:
              "Targets re-grade every entry, past and present, on the next load. End-of-day rules apply from the next reminder or cutoff after saving.",
            reset: "Each card's “Reset to defaults” refills its shipped values. Press that card's “Save changes”.",
          },
        ],
        watchOut: [
          "Auto-capture cannot see every field, so an auto-saved day can read low on Bonus & Commission. Keep an amend window so people can correct it.",
        ],
        shot: {
          file: "console-daily-targets.png",
          route: consoleHref("delivery", "daily-targets"),
          caption: "Daily targets per role, and the end-of-day logging rules below them.",
          highlight: { text: "Enforce end-of-day rules", label: "The cutoff, reminder and auto-save" },
        },
      },
      {
        id: "gamification",
        name: "Gamification",
        where: W("delivery", "Gamification"),
        href: consoleHref("delivery", "gamification"),
        what: "The XP values, levels, badges, weekly quests and student journey, kept as dated versions.",
        use: [
          "Open Founder Console, then Delivery & team, then Gamification.",
          "Pick a version from the list; the live one is marked.",
          "To change only future work, press “New version”. It copies the selected rules and starts tomorrow; change “In force from” if needed.",
          "Edit the XP rules, Levels, Badges, Quests and Student journey tabs.",
          "Press “Save changes”.",
        ],
        logic: [
          "Each version applies from its In force from date until the next version starts.",
          "XP, levels and badges are worked out from recorded work, not stored. Editing a version re-scores the dates it covers.",
          "Editing the live version re-scores every day since it began. Editing a past version re-scores its period. A future version changes nothing until its date.",
          "Deleting a version hands its dates to whichever version then covers them.",
          "The lowest level must start at 0 XP, levels must climb with XP, keys must be unique, and only one version may start on a given date.",
          "Reward rules point at badges and quests from the live version.",
        ],
        controls: [
          {
            setting: "Gamification rulesets",
            where: W("delivery", "Gamification"),
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "One shipped ruleset",
            effect: "Re-computed: every screen that shows XP updates for the dates the edited version covers.",
            reset:
              "“Reset to defaults” deletes every version as soon as you confirm, and the shipped rules cover all history. XP, levels and badges are recomputed.",
          },
        ],
        watchOut: [
          "Editing the live version can lower recent XP. Use “New version” unless you are fixing a mistake.",
        ],
        shot: {
          file: "console-gamification.png",
          route: consoleHref("delivery", "gamification"),
          caption: "Gamification: the version picker and the five rule tabs.",
          highlight: { text: "New version", label: "Change the rules from tomorrow only" },
        },
      },
      {
        id: "goals",
        name: "Goals",
        where: W("delivery", "Goals"),
        href: consoleHref("delivery", "goals"),
        what: "Targets for the whole team or one person, over a month, quarter or year.",
        use: [
          "Open Founder Console, then Delivery & team, then Goals.",
          "Press “+ New goal”.",
          "Name it, pick the metric, type the target, choose whole team or one person, the period and the start date.",
          "Keep Active ticked and press “Create goal”.",
          "Use Edit or Delete on a goal's row later.",
        ],
        logic: [
          "Progress is worked out from work already recorded. Nothing is typed in, and a goal set today for a past period shows how that period went.",
          "The start date snaps to the first day of its month, quarter or year.",
          "Whole-team goals count the combined total; one-person goals count that person only.",
          "Revenue goals are in whole rupees.",
          "A paused goal stops being tracked and stops paying reward rules.",
          "A person's own open goals show on their desk.",
          "Deleting a goal also deletes any reward rule that pays on it, with that rule's grants.",
        ],
        controls: [
          {
            setting: "Team and personal goals",
            where: W("delivery", "Goals"),
            href: consoleHref("delivery", "goals"),
            who: ["ADMIN"],
            default: "No goals",
            effect: "Derived: changing a target or period re-measures progress straight away. Nothing else changes.",
            reset: "There is no reset. Edit, pause or delete each goal.",
          },
        ],
        watchOut: [
          "A reward pointed at a goal is only granted when someone presses “Scan for qualifiers” on Rewards. Nothing scans by itself.",
        ],
        shot: {
          file: "console-goals.png",
          route: consoleHref("delivery", "goals"),
          caption: "Goals with live progress bars, met, missed or running.",
          highlight: {
            text: "Targets for the team or one person, over a month, quarter or year.",
            label: "Every goal and how it is going",
          },
        },
      },
      {
        id: "rewards",
        name: "Rewards",
        where: W("delivery", "Rewards"),
        href: consoleHref("delivery", "rewards"),
        what: "Rules that decide who has earned a bonus, commission or perk, and the grants they produce.",
        use: [
          "Open Founder Console, then Delivery & team, then Rewards. The number on the tab counts pending grants.",
          "In Rules, add a rule: name, what it is for, kind, trigger, roles, and the amount in rupees, euros or both, or the perk.",
          "Press “Scan for qualifiers”.",
          "In Pending, Approve or Decline each grant. An approved grant then gets “Mark paid”.",
          "Use Ledger to see every grant ever made.",
        ],
        logic: [
          "Triggers are a streak of days, a level reached, a badge earned, a quest completed, XP or a metric over a window, or a goal met.",
          "A scan re-checks all history and adds new qualifiers as pending. It is safe to repeat: nobody is paid twice and a declined grant never comes back.",
          "Amounts and the exchange rate are stamped on a grant when it is created. Editing a rule later never re-prices it.",
          "Grants appear only when someone presses Scan. Nothing scans by itself.",
          "A rule whose trigger no longer makes sense is shown as broken and is skipped.",
          "“Mark paid” only changes the grant's status. It does not record a payment in Finance.",
          "“Reopen” sends a declined or paid grant back to pending.",
        ],
        controls: [
          {
            setting: "Reward rules and grant approvals",
            where: W("delivery", "Rewards"),
            href: consoleHref("delivery", "rewards"),
            who: ["ADMIN"],
            default: "No rules",
            effect:
              "Existing grants keep their amounts. A scan can add grants for qualifications that happened in the past.",
            reset: "There is no reset. Switch a rule off, or delete it.",
          },
        ],
        watchOut: [
          "Deleting a rule deletes every grant it ever produced, including paid ones. Switch it off instead to keep the history.",
        ],
        shot: {
          file: "console-rewards.png",
          route: consoleHref("delivery", "rewards"),
          caption: "Rewards: pending grants, the rules and the full ledger.",
          highlight: { text: "Scan for qualifiers", label: "Find who has earned a reward" },
        },
      },

      // ───────────────────────────── System ─────────────────────────────
      {
        id: "not-armed",
        name: "Not armed",
        where: W("system", "Not armed"),
        href: consoleHref("system", "not-armed"),
        what: "One list of every automatic engine that is built but switched off, and every channel that is on but failing.",
        use: [
          "Open Founder Console, then System, then Not armed. The number on the tab counts what is off or failing.",
          "Read “Armed but not working” first, if it appears.",
          "For each row under Not armed, read what is not happening, then follow the arrow to where it is switched on.",
          "Rows marked “needs a deploy” are server settings, not in-app switches.",
        ],
        logic: [
          "It covers sixteen engines and lists what is off before what is on.",
          "Scheduled jobs count as running if any job has run in the last two hours.",
          "Availability counts as armed when at least one calendar is on with a day selected.",
          "Class reminders count as armed only when they are on and sending for real, not rehearsing.",
          "Agreement chasing counts as armed when any reminder day is set, and new leads onto the Deals board ships on, so both start out armed.",
          "Lead capture counts as armed once any lead route has recorded a delivery.",
          "“Armed but not working” lists channels the provider is refusing, or that skip every send. A toggle does not fix those.",
        ],
        watchOut: [
          "The tutor-fee posting row points to Maintenance, but that switch is not on the Maintenance panel.",
          "Most other rows depend on the scheduled jobs. If that row is off, switching anything else on changes nothing.",
        ],
        shot: {
          file: "console-not-armed.png",
          route: consoleHref("system", "not-armed"),
          caption: "Not armed: what is switched off, what it costs, and where to switch it on.",
          highlight: {
            text: "Built, switched off, and doing nothing right now.",
            label: "Engines that are off",
          },
        },
      },
      {
        id: "alerts",
        name: "Alerts & Chasing",
        where: W("system", "Alerts & Chasing"),
        href: consoleHref("system", "alerts"),
        what: "The rules that decide when the app contacts someone: the speed-to-lead alert, the payment chase ladder, and attendance risk with self check-in.",
        use: [
          "Open Founder Console, then System, then Alerts & Chasing.",
          "Speed-to-lead: switch on “Alert me about unanswered leads”, set the minutes and counts, add recipient emails, and save that card.",
          "Payment chase ladder: set each stage's day and channel, the copy address and the per-run cap. Press “Preview the next run” before switching on “Chase late payments automatically”, then save.",
          "Attendance risk: set the amber and red levels, the missed-in-a-row rule and the minimum sessions, plus the check-in, absence and catch-up settings. Save that card.",
        ],
        logic: [
          "Speed-to-lead counts only leads that arrived within the look-back window. It emails when at least the set number are late, then stays quiet for the cooldown. It is checked every few minutes.",
          "The chase ladder keys off each instalment's own due date; negative days are before it. Stages never fire out of order, so an instalment already well overdue gets the final notice only.",
          "A paid instalment is re-checked just before every send. At most the per-run cap goes out each run, once a day.",
          "Attendance below amber reads amber, below red reads red, and missing the set number of classes in a row is red on its own. Below the minimum sessions the signal reads unknown.",
          "Self check-in lets students mark themselves during a window. A check-in after the on-time minutes records Late, which still counts as attending.",
          "Absence and catch-up notices are in-app. The catch-up grace counts from when the recording was posted.",
          "Without the scheduled jobs none of these fire. Without email, the alert and the ladder run and log who they would contact, but send nothing.",
        ],
        controls: [
          {
            setting: "Speed-to-lead alert, payment chase ladder and attendance rules",
            where: W("system", "Alerts & Chasing"),
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default:
              "Speed-to-lead off: late after 15 minutes, leads from the last 120 minutes, alert at 3, quiet for 60, no recipients. Chase ladder off: 10 days before, 1 day after and 7 days after, all by email, cap of 50. Attendance: amber below 80%, red below 60%, red after 3 missed in a row, 2 sessions minimum; self check-in on with a 15-minute window, on time for 10; register hidden until shown; absence and catch-up notices on; 24-hour catch-up grace; register chase escalates after 24 hours; no viewing limit on recordings.",
            effect:
              "The alert and the ladder act from their next run, including on leads and instalments already in the system. Attendance levels re-judge every student on the next load. The viewing window only pre-selects for new recordings.",
            reset: "Each card's “Reset to defaults” refills it. Press that card's “Save changes”.",
          },
        ],
        watchOut: [
          "The chase ladder messages paying students. Preview the next run and read the full list before switching it on.",
          "Red must be at or below amber, and the on-time minutes cannot be longer than the window.",
        ],
        shot: {
          file: "console-alerts.png",
          route: consoleHref("system", "alerts"),
          caption: "Alerts & Chasing: the speed-to-lead alert, the payment ladder and the attendance rules.",
          highlight: { text: "Payment chase ladder", label: "Messages that go to paying students" },
        },
      },
      {
        id: "leaderboard",
        name: "Leaderboard",
        where: W("system", "Leaderboard"),
        href: consoleHref("system", "leaderboard"),
        what: "How the student sprint leaderboard scores, who is ranked against whom, and what students see.",
        use: [
          "Open Founder Console, then System, then Leaderboard.",
          "Use “Show the leaderboard” to turn the board on or off.",
          "Choose what students see, which period counts, the ranking scope, top N, and the smallest cohort that shows an average.",
          "For each metric, switch it on or off and set its points. Self-reported metrics also get a weekly cap.",
          "Press “Save changes”.",
        ],
        logic: [
          "Off hides the board for students and staff alike.",
          "Named shows the full ranking. Anonymised shows each student their own name and everyone else as a letter. Staff only shows students just themselves.",
          "Sprint counts from the sprint start. A cohort whose sprint has not started is counted from enrolment, and the page says so.",
          "A student's own row always shows, even below the top N.",
          "The cohort average is hidden below the minimum cohort size, which can never be under 3, so nobody can work out a classmate's score.",
          "Measured metrics come from records nobody can type in. Self-reported ones score at once, the coach can correct them, and the weekly cap limits them.",
          "Metrics are fixed in the app. You can switch them and change their points, but not add new ones. 0 points keeps a metric visible but unscored.",
        ],
        controls: [
          {
            setting: "Leaderboard visibility, period, scope and points",
            where: W("system", "Leaderboard"),
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default:
              "On. Named. Counted from sprint start. Ranked within the cohort. Whole cohort shown. Average needs 5 students. Each metric at its shipped points.",
            effect: "Re-computed: the board is worked out when it is opened, so new points apply to the whole period at once.",
            reset: "“Reset to defaults” refills the shipped settings. Press “Save changes” to apply.",
          },
        ],
        shot: {
          file: "console-leaderboard.png",
          route: consoleHref("system", "leaderboard"),
          caption: "The sprint leaderboard settings and the points each metric is worth.",
          highlight: { text: "Sprint leaderboard", label: "How students are ranked" },
        },
      },
      {
        id: "student-lifecycle",
        name: "Why students stop",
        where: W("system", "Why students stop"),
        href: consoleHref("system", "student-lifecycle"),
        what: "The reasons a coach can pick when discontinuing a student, and who may discontinue.",
        use: [
          "Open Founder Console, then System, then Why students stop.",
          "Edit or remove a reason, or press “Add a reason”.",
          "Choose whether a coach may type a reason that is not on the list, and whether coaches may discontinue their own students.",
          "Press “Save changes”.",
        ],
        logic: [
          "The list is what the coach picks from, and what the churn breakdown on Students totals.",
          "Removing a reason stops it being offered. Enrolments already recorded keep it, and the breakdown still counts them.",
          "A coach picking a reason that has since been removed is refused and asked for another.",
          "With coaches allowed, the coach who owns an enrolment can discontinue it. Otherwise only Admin and Head coach can.",
          "Keep at least one reason, up to 25, with no duplicates. Blank rows are dropped on save.",
          "Discontinuing never touches money. Instalments stay owed and payment reminders keep running.",
        ],
        controls: [
          {
            setting: "Discontinue reasons and who may discontinue",
            where: W("system", "Why students stop"),
            href: consoleHref("system", "student-lifecycle"),
            who: ["ADMIN"],
            default:
              "Seven reasons: Found a job elsewhere, Financial difficulty, Personal or family reasons, Not enough time, Unhappy with the programme, Moved country or visa issue, Unresponsive - no contact. Other reasons allowed. Coaches may discontinue their own students.",
            effect: "Forward only. Past discontinuations keep their reason.",
            reset: "“Reset to defaults” refills the shipped list. Press “Save changes” to apply.",
          },
        ],
        shot: {
          file: "console-student-lifecycle.png",
          route: consoleHref("system", "student-lifecycle"),
          caption: "The discontinue reasons a coach picks from, and who may discontinue.",
          highlight: { text: "Add a reason", label: "The churn vocabulary" },
        },
      },
      {
        id: "improvements",
        name: "Improvements",
        where: W("system", "Improvements"),
        href: consoleHref("system", "improvements"),
        what: "Who is emailed when someone reports a problem or suggests an improvement.",
        use: [
          "Open Founder Console, then System, then Improvements.",
          "Type the developer's email, or leave it blank for in-app only.",
          "Choose “Email immediately when somebody is blocked” and “One daily summary of everything else”.",
          "Press “Save changes”.",
        ],
        logic: [
          "Filing is always on, for every role, from the top bar. This panel only controls email.",
          "A blank address means nothing is sent and nothing breaks. The queue and the bell count still work.",
          "A blocking report emails straight away. Everything else rides one daily summary, which sends nothing on a quiet day and never repeats a report already emailed.",
          "Email must be armed for anything to send.",
        ],
        controls: [
          {
            setting: "Improvement notification email",
            where: W("system", "Improvements"),
            href: consoleHref("system", "improvements"),
            who: ["ADMIN"],
            default: "No address; both switches on",
            effect: "Applies from the next report and the next daily summary.",
            reset: "“Reset to defaults” refills the shipped settings. Press “Save changes” to apply.",
          },
        ],
        shot: {
          file: "console-improvements.png",
          route: consoleHref("system", "improvements"),
          caption: "Who hears about reported problems, and when.",
          highlight: { text: "Developer's email", label: "Blank means in-app only" },
        },
      },
      {
        id: "maintenance",
        name: "Maintenance",
        where: W("system", "Maintenance"),
        href: consoleHref("system", "maintenance"),
        what: "System health, daily housekeeping, ledger auto-posting, the scheduled founder digest and the commission payout run.",
        use: [
          "Open Founder Console, then System, then Maintenance.",
          "Read Scheduled jobs and Error tracking first. A job that has never run is not wired up.",
          "In Daily housekeeping, choose the FX pre-warm, the overdue sweep and data pruning, and save that card.",
          "In Ledger auto-posting, choose invoice issuance posting and commission payout posting, and save.",
          "In Scheduled founder digest, set how often, when and to whom, and save.",
          "Press “Record this month's payout” to save this month's commission totals.",
        ],
        logic: [
          "Everything here runs from the scheduled jobs. If they are not set up, nothing on this panel fires.",
          "The overdue sweep marks sent invoices and due instalments overdue once their date has passed. Part-paid invoices are left alone.",
          "Data pruning deletes WhatsApp message records and unaccepted invites older than their window, once a day. 0 days keeps that kind forever.",
          "Invoice issuance posting books the receivable and the income when an invoice is issued. Once on, it also posts earlier issued invoices that have no entry yet.",
          "Commission posting books the month's total as money owed when you record a payout run. It is not a cash payment.",
          "The payout run saves this month's commission totals. Pressing it again in the same month replaces that month's snapshot.",
          "The digest goes by email. A WhatsApp copy only arrives if that number messaged the business in the last 24 hours.",
        ],
        controls: [
          {
            setting: "Housekeeping, ledger posting, founder digest and payout run",
            where: W("system", "Maintenance"),
            href: consoleHref("system", "maintenance"),
            who: ["ADMIN"],
            default:
              "FX pre-warm on, overdue sweep on, pruning off (WhatsApp messages 365 days, expired invites 30 days). Both ledger postings off. Digest off: weekly, Monday, 9:00 AM, no recipients.",
            effect:
              "Commission posting is forward only. Invoice posting also back-fills earlier issued invoices over the next runs. Pruning permanently deletes old rows from its next daily run.",
            reset: "Each card's “Reset to defaults” refills it. Press that card's “Save changes”.",
          },
        ],
        watchOut: [
          "Archived records, such as deleted leads, invoices and payments, are permanently purged after 90 days by a separate nightly job. The pruning switch here does not control it.",
          "The tutor-fee posting switch is not on this panel, although other screens point here for it.",
          "Pruning deletes for good. Leave it off unless you are sure.",
        ],
        shot: {
          file: "console-maintenance.png",
          route: consoleHref("system", "maintenance"),
          caption: "Maintenance: job health, housekeeping, ledger posting, the digest and the payout run.",
          highlight: { text: "Ledger auto-posting", label: "Switches that write to the books" },
        },
      },
    ],
    related: [
      { section: "people", why: "Per-person access and permissions set in Users win over the Sections defaults; team profiles hold each caller's lead share." },
      { section: "finance", why: "Commission rates, payment types, expense categories and instalment pricing are all applied on the Finance screens." },
      { section: "telecaller", why: "Auto-saved end-of-day logs that nobody amends read low on Bonus & Commission, and it is one of the money screens Sections asks you to confirm before giving to a new role." },
      { section: "cash", why: "Cash Health judges runway and payables against the Cash targets panel." },
      { section: "payments", why: "Every invoice prints the issuer block and starts from the tax rates on the Invoicing panel." },
      { section: "german-note", why: "Batch costs and tutor fees are priced from the Tutor Fee bands." },
      { section: "pipeline", why: "Lead rotation, ranking, call-backs, pipeline mode and qualification scoring are set under Sales ops." },
      { section: "my-desk", why: "Each caller's queue order, call-backs and own commission follow Call Distribution and Commission." },
      { section: "bookings", why: "Availability fills the calendars, Zoom links hosts the calls and Confirm-or-cancel can release slots." },
      { section: "opportunities", why: "The Deals board follows the pipeline mode and the new-lead switch on Operations." },
      { section: "agreements", why: "Prompts, delivery channel, signing window and reminders come from the Agreements panel." },
      { section: "students", why: "The default coach, the discontinue reasons and the book-order threshold apply to student records." },
      { section: "daily-log", why: "Entries are graded against Daily Targets and closed by the end-of-day rules." },
      { section: "arena", why: "XP, levels, badges, quests, goals and rewards all come from the Gamification, Goals and Rewards panels." },
      { section: "attendance", why: "Attendance risk, self check-in and catch-up rules live under Alerts & Chasing." },
      { section: "leaderboard", why: "The student board's points, visibility and scope are set on the Leaderboard panel." },
      { section: "improvements", why: "Who is emailed about reported problems is set on the Improvements panel." },
      { section: "activity", why: "Every console save is written to the Activity Log with who made it." },
      { section: "whatsapp", why: "The confirm-or-cancel rule can also be changed from WhatsApp settings, and many engines need WhatsApp armed to reach anyone." },
    ],
    faq: [
      {
        q: "I changed a setting but nothing happened.",
        a: "Check three things. Did you press “Save changes”? On most panels “Reset to defaults” only refills the form. Is the engine switched on? See System, then Not armed. Are the scheduled jobs running? Most automatic work only happens when they tick, and Maintenance shows when each job last ran.",
      },
      {
        q: "I changed the commission rates and last month's report changed too.",
        a: "That is expected. The report is worked out fresh from the current rates for any month you open. To freeze a month, press “Record this month's payout” on System, then Maintenance, before the month ends and before you change rates. That snapshot keeps its totals.",
      },
      {
        q: "Someone still sees, or cannot see, a screen after I changed Sections.",
        a: "They need to reload the page. A per-person grant or block in Users beats the Sections defaults, and Admins always see every screen that is switched on.",
      },
      {
        q: "Who changed this setting, and when?",
        a: "Every save on this console is written to the Activity Log with who made it and when. A confirm-or-cancel change also records which screen it was made from.",
      },
      {
        q: "Can anyone other than an Admin change these rules?",
        a: "The console itself is Admin only. One exception: the confirm-or-cancel rule and the booking window can also be changed from Bookings, Manage availability, by anyone who can open Bookings.",
      },
    ],
  },
];
