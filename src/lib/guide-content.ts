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
    section: "console", icon: "🎛️", title: "Founder Console", href: "/console",
    what: "The rules of the app itself - sections, the XP engine, goals and rewards. Admin-only.",
    steps: [
      "Sections: rename, re-icon, reorder, regroup or switch off any nav section, and set which roles see it by default. Per-user overrides in Users → Users & access still win.",
      "Gamification: edit XP values, the level ladder, badges, weekly quests and the student journey. Use “New version” to change the rules from a future date - work already done keeps the XP it earned, so nobody is demoted and no badge is re-locked.",
      "Goals: set a target for the team or one person over a month, quarter or year. Progress is derived from work already recorded, so a goal set today immediately shows how the period is going.",
      "Rewards: write rules like “30-day streak → ₹2,000”, then hit Scan for qualifiers. Whoever qualified shows up as a pending grant to approve, decline or mark paid.",
      "Scanning is safe to repeat: nobody is ever paid twice, and a grant you declined never comes back.",
    ],
    tip: "Editing the live ruleset re-scores work done since that ruleset began. To change only what happens next, create a new version instead.",
  },
  {
    section: "activity", icon: "🛡️", title: "Activity Log", href: "/activity",
    what: "Every action anyone takes in the app, stamped with the exact time it happened. Admin-only.",
    steps: [
      "Feed answers “what's been happening” — every action grouped by day, newest first. Table answers “what exactly did Asma do at 3pm” — one row per action, timed to the second.",
      "Filter by who, section, action type or date range, or search for a person or record by name. Every filter lives in the address bar, so you can bookmark a view or paste the link to someone.",
      "The engines log their own work under their own name — “Reminder engine”, “Booking engine” — with a cog instead of a face. If the automation messaged 40 leads overnight, that is what you will see; it is never filed under whoever last pressed “Run now”. Pick an engine in the Who filter to read only what ran on its own.",
      "Every time is IST, and always exact. The “12m ago” next to it is only a convenience — the real timestamp never moves.",
      "“Details” on a row opens what actually changed: the value before and the value after.",
      "The log only holds what happened after it was switched on. It cannot reconstruct history from before that.",
    ],
    tip: "Nothing here can be edited or deleted — not by a telecaller, not by you, not from the database. That is the point: a log its subjects could tidy up would be worth nothing.",
  },
  {
    section: "finance", icon: "💰", title: "Finance", href: "/finance",
    what: "Daily money picture - income, expenses, profit, receivables. Admin-only.",
    steps: [
      "Enter every payment received under the Income tab (INR, EUR, or both - FX is stamped automatically).",
      "Enter expenses daily; tick “Is this COGS?” for direct delivery costs like Karthick's salary or Skool.",
      "For instalment students, add a Pending Payment with the agreed total - “paid so far” sums itself from income entries.",
      "Overdue rows turn red on their own. Metric cards at the top are always this-month, auto-calculated.",
      "Commission tab: each student-linked payment splits automatically - 5% when one person did both calls, 3% each when first call and discovery were split.",
    ],
    tip: "Link income entries to a student (optional dropdown) - that powers LTV and the commission report.",
  },
  {
    section: "pipeline", icon: "📞", title: "Pipeline", href: "/pipeline",
    what: "Every lead from first contact to Won, plus the monthly target bar.",
    steps: [
      "Add each new lead with source and stage; update the stage as they move - history is kept automatically.",
      "Stages now cover the whole Synamate flow: workshop branch, offer follow-up, deposit follow-up and confirmed deposit; from deposit onward pick Split or Full pay.",
      "After every discovery call, record the outcome and tick Highly Qualified + BANT boxes honestly.",
      "Speed-to-lead pills: green = contacted within 5 minutes, amber within an hour, grey slower - “Mark contacted” stamps the clock.",
      "Admin: new leads auto-assign per the first-call split (People → profile shares, Saturday rule respected); reassign any lead inline.",
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
      "Users & access → Invite user: pick a role as a starting preset, then adjust two separate things. MODULES are what they can see; CAPABILITIES are what they can change. A head coach can read Finance without being able to post to the ledger.",
      "You'll get a single-use invite link to send them — they set their own password, and nobody else ever sees it. Minting a new link kills the old one.",
      "Suspend signs a person out immediately and blocks them from signing in again; Reactivate undoes it. Delete removes the login for good — the work they recorded stays.",
    ],
    tip: "Grant “Manage team & access” to delegate seat management. A delegate can never mint an Admin, edit an Admin, edit their own row, or hand out a capability they don't hold themselves.",
  },
  {
    section: "students", icon: "🎓", title: "Students", href: "/students",
    what: "Every B2 student, their 90/120-day journey, signals, satisfaction and LTV.",
    steps: [
      "Create a student when they pay - duration and end date derive from the program level.",
      "The tracker lists active Guided/Elite students: day number, milestone, signal dot, days since session.",
      "Open a student to update the tracker after each session; milestone and signal changes are logged forever.",
      "Generate the sprint plan on a Guided/Elite enrollment (13 or 18 weeks), set weekly targets, and record the weekend check-in as Achieved or Missed.",
      "The Early-warning radar on top flags drifting students - missed sprint weeks show up here too.",
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
      "Weekly sprint: see your week-wise targets and submit the weekend check-in right on this page.",
      "Badges unlock automatically (first application, first interview, offer…) - collect them all.",
    ],
    tip: "Momentum cooling? Book a session - activity is what keeps the flame alive.",
  },
  {
    section: "cv-check", icon: "🧾", title: "CV Diagnostic", href: "/cv-check",
    what: "Upload/paste CV + target JD → JD-match score, B2-template conformance, generated fix-list.",
    steps: [
      "Upload the CV as a PDF or Word (.docx) - or paste the text - on the left, the German JD on the right, hit Run diagnostic. Uploaded files are read in-memory and never stored.",
      "Generated suggestions are the risk-first to-do list - work top-down, most urgent first.",
      "Template match grades the CV against the B2 “How to edit the resume” manual; a red placeholder alert catches un-edited fields (“Position Name”, “mm/jjjj”, “xxxx@gmail.com”).",
      "Missing keywords are what the JD asks for and the CV lacks; weak bullets have no verb and no number - rebuild as “Verb + what + result”.",
    ],
    tip: "Nothing is saved and nothing is rewritten - it diagnoses, the student does the work.",
  },
  {
    section: "german-note", icon: "🇩🇪", title: "German Note", href: "/german-note",
    what: "German language batches: a Classroom of Fathom recordings, a class schedule, a Skool-style community, members and a leaderboard.",
    steps: [
      "Open a batch → Classroom: lessons grouped into modules with a course-progress bar. Mark each class Watched to track completion. Recordings are yours for LIFETIME.",
      "Schedule tab: upcoming live classes with a Join link; tutors schedule them, students see what's next (also surfaced on the main page).",
      "Tutors: classes are recorded by fathom.ai - hit Copy share link in Fathom and paste it into the batch; use Manage modules to build the curriculum.",
      "Community feed (main page + each batch's Discussion): post with a title/category/image, @mention people, comment and like. Likes are community points that raise your level.",
      "Leaderboard ranks members by likes received (7-day / 30-day / all-time); Members lists everyone with their level and activity.",
      "Admins manage batches, members and tutor accounts under Manage.",
    ],
    tip: "Recordings play right on the page - use “open original” to open them on Fathom itself.",
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
      "Red dot items need action now (overdue money, red students); amber is watch; green is a win.",
      "Alerts clear themselves when the underlying problem is fixed - the bell is always current.",
      "Click any alert to jump straight to the page where you fix it.",
    ],
  },
];
