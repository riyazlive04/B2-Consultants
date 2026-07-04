import type { SectionKey } from "./sections";

/**
 * App Guide content - one short, practical how-to per feature. Each entry is
 * gated by its section key, so people only read guides for features they can open.
 */

export type GuideEntry = {
  section: SectionKey | "general"; // "general" = visible to everyone
  icon: string;
  title: string;
  href: string; // where the feature lives
  what: string; // one line: what it is
  steps: string[]; // 3-5 short steps
  tip?: string;
};

export const GUIDES: GuideEntry[] = [
  {
    section: "finance", icon: "💰", title: "Finance", href: "/finance",
    what: "Daily money picture - income, expenses, profit, receivables. Admin-only.",
    steps: [
      "Enter every payment received under the Income tab (INR, EUR, or both - FX is stamped automatically).",
      "Enter expenses daily; tick “Is this COGS?” for direct delivery costs like Karthick's salary or Skool.",
      "For instalment students, add a Pending Payment with the agreed total - “paid so far” sums itself from income entries.",
      "Overdue rows turn red on their own. Metric cards at the top are always this-month, auto-calculated.",
    ],
    tip: "Link income entries to a student (optional dropdown) - that's what powers LTV.",
  },
  {
    section: "pipeline", icon: "📞", title: "Pipeline", href: "/pipeline",
    what: "Every lead from first contact to Won, plus the monthly target bar.",
    steps: [
      "Add each new lead with source and stage; update the stage as they move - history is kept automatically.",
      "After every discovery call, record the outcome and tick Highly Qualified + BANT boxes honestly.",
      "Marking a lead Won asks which program they bought - that feeds conversions by level.",
      "Admin: “Call these first” ranks the hottest open leads; “Deals at risk” lists ghosted and stalled ones.",
    ],
    tip: "The target bar defaults to ₹8,00,000 - Admin can change it per month right on the bar.",
  },
  {
    section: "daily-log", icon: "📝", title: "My Daily Log", href: "/daily-log",
    what: "Your numbers for today, once per day, before 7 PM.",
    steps: [
      "Open the page - fields you already did in the system today are pre-filled (auto-captured).",
      "Adjust, add notes/blockers, submit. One log per day; corrections go through Admin.",
      "Update your OKR progress right below the form - takes ten seconds, keeps your circles green.",
    ],
    tip: "Submit daily to grow your 🔥 streak - 7, 14 and 30-day milestones are tracked.",
  },
  {
    section: "arena", icon: "🏆", title: "Arena", href: "/arena",
    what: "XP, levels, weekly quests and badges - earned automatically from work you already log.",
    steps: [
      "Every daily log, pipeline move, call outcome, student milestone and OKR pays XP - the ledger is your audited history, so nothing extra to enter.",
      "Weekly quests reset each Monday and track themselves from your daily-log numbers; finish them for bonus XP.",
      "Streaks pay bonuses at 7/14/30/60/90 days - the same streak you see on your daily-log page.",
      "The leaderboard has week / month / all-time views; badges live in the gallery with the exact unlock rules.",
    ],
    tip: "There is no way to farm points: corrections and backward moves earn nothing. The only strategy is doing the work.",
  },
  {
    section: "people", icon: "👥", title: "People", href: "/people",
    what: "Team profiles, OKRs, daily-log board and user accounts. Admin-only.",
    steps: [
      "Daily logs tab: who logged today, the 7 PM missing badge, weekly totals per person.",
      "OKRs tab: set max 3 per person per month; circles go green/amber/red on completion %.",
      "Team & org chart: profile cards, display-only chart, reorder with arrows.",
      "Users & access: create logins, pick a role, then toggle exactly which features each person sees.",
    ],
    tip: "A profile's “daily log form” setting decides which questions that person answers each day.",
  },
  {
    section: "students", icon: "🎓", title: "Students", href: "/students",
    what: "Every B2 student, their 90/120-day journey, signals, satisfaction and LTV.",
    steps: [
      "Create a student when they pay - duration and end date derive from the program level.",
      "The tracker lists active Guided/Elite students: day number, milestone, signal dot, days since session.",
      "Open a student to update the tracker after each session; milestone and signal changes are logged forever.",
      "The Early-warning radar on top flags drifting students - review and set the signal colour yourself.",
    ],
    tip: "Upgrades = add a second enrollment on the same student; LTV sums across all of them.",
  },
  {
    section: "my-journey", icon: "🗺️", title: "My Journey", href: "/my-journey",
    what: "Your road to Germany as a game: journey XP, stage titles, badges and a focus list for your current stage.",
    steps: [
      "Your ring fills as you pass the 7 milestones - Explorer all the way to Alumni.",
      "Sessions, applications and interviews all add XP; the numbers come from your coach's tracker.",
      "“This stage” lists exactly what to focus on right now - work that list before anything else.",
      "Badges unlock automatically (first application, first interview, offer…) - collect them all.",
    ],
    tip: "Momentum cooling? Book a session - activity is what keeps the flame alive.",
  },
  {
    section: "cv-check", icon: "🧾", title: "CV Diagnostic", href: "/cv-check",
    what: "Paste CV + target JD → match score, missing keywords, weak bullets.",
    steps: [
      "Paste the student's CV text on the left, the German JD on the right, hit Run diagnostic.",
      "Missing keywords are what the JD asks for and the CV lacks - coach them in where true.",
      "Weak bullets have no action verb and no number - rebuild as “Verb + what + result”.",
      "Structure checks cover LinkedIn link, skills block, quantification, length and German-market signals.",
    ],
    tip: "Nothing is saved and nothing is rewritten - it diagnoses, the student does the work.",
  },
  {
    section: "funnel", icon: "⏬", title: "Conversion Funnel", href: "/funnel",
    what: "Awareness → enrolled, weekly snapshots, drop-off alert, source attribution. Admin-only.",
    steps: [
      "Every Monday, save the weekly snapshot - awareness and GB downloads are manual, the rest is pre-filled from Pipeline/Students.",
      "The red box always names your biggest drop-off stage this month.",
      "The attribution table shows which lead source actually produces students and revenue.",
      "Ghosted Blueprint has its own tracker - tag GB students at enrollment for it to be accurate.",
    ],
  },
  {
    section: "cash", icon: "🏦", title: "Cash Health", href: "/cash",
    what: "Survival math: runway, break-even, receivables, payables. Admin-only.",
    steps: [
      "Enter the bank balance every Monday - the 12-week chart and runway update from it.",
      "Runway = cash ÷ average of the last 3 months' expenses; green ≥6mo, amber 3-6, red <3.",
      "Receivables auto-pull from Finance pending payments - never enter them twice.",
      "Payables hold fixed costs; their monthly total is your break-even revenue line.",
    ],
    tip: "The runway badge in the top bar follows you on every screen - click it to jump here.",
  },
  {
    section: "general", icon: "🔔", title: "Notifications & badges", href: "/",
    what: "The bell shows live, in-app alerts - nothing is ever emailed or WhatsApped.",
    steps: [
      "Red dot items need action now (overdue money, red students); amber is watch; brass is a win.",
      "Alerts clear themselves when the underlying problem is fixed - the bell is always current.",
      "Click any alert to jump straight to the page where you fix it.",
    ],
  },
];
