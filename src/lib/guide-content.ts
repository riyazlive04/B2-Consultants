import type { AppRole, SectionKey } from "./sections";

/**
 * App Guide content - one short, practical how-to per feature. Each entry is
 * gated by its section key, so people only read guides for features they can open.
 */

/**
 * A screenshot of the real screen, with the thing to click boxed on it.
 *
 * `hotspot` is in PERCENTAGES of the image, not pixels, so a re-capture at a different window
 * size does not move the box off its target - which is what makes these refreshable by script
 * (`scripts/capture-guide-shots.ts`) instead of by hand.
 */
export type GuideShot = {
  /** Served from `public/guide/`. Authenticated-only, so it needs no middleware public prefix. */
  src: string;
  /** What the reader is looking at. Required - an unlabelled screenshot explains nothing. */
  caption: string;
  hotspot?: { x: number; y: number; w: number; h: number; label: string };
};

export type GuideEntry = {
  section: SectionKey | "general"; // "general" = visible to everyone
  icon: string;
  title: string;
  href: string; // where the feature lives
  what: string; // one line: what it is
  /**
   * THE CLICK PATH - how you get there, as a breadcrumb.
   *
   * Added because the guide described what a screen does and never said where it is. For
   * somebody who does not already know the app, "open Batches & Plans" is not an instruction.
   * Rendered as chips: Sidebar › Classroom › Batches & Plans › Plans tab.
   *
   * Optional only so the twenty entries written before this field keep working; every new entry
   * sets it.
   */
  path?: string[];
  steps: string[]; // 3-5 short steps
  /** Real screenshots of the screen being described. */
  shots?: GuideShot[];
  tip?: string;
};

/**
 * A WALKTHROUGH THAT CROSSES SECTIONS - what you hand a new employee.
 *
 * The gap the per-section guides could not close. Each of those explains one screen, and the
 * jobs that actually confuse people are the ones that span several: onboarding a student touches
 * Contacts, Bookings, Pipeline, Agreements, Students, Finance and Batches, and no single entry
 * could ever describe it.
 */
export type GuideJourney = {
  key: string;
  title: string;
  /** Who this walkthrough is for. Readers outside these roles never see it. */
  forRoles: AppRole[];
  summary: string;
  steps: {
    n: number;
    title: string;
    /** The click path for THIS step, same shape as `GuideEntry.path`. */
    where: string[];
    /** What to do once you are there, in one or two plain sentences. */
    does: string;
    shot?: GuideShot;
  }[];
};

export const GUIDES: GuideEntry[] = [
  {
    section: "onboarding", icon: "🧭", title: "Onboarding", href: "/onboarding",
    path: ["Sidebar", "Students", "Onboarding"],
    what: "Everyone between a first enquiry and their first class, and what each of them is waiting on.",
    shots: [
      {
        src: "/guide/onboarding-board.png",
        caption:
          "The onboarding board. Everyone between a first enquiry and their first class, grouped by the step they have reached.",
        hotspot: { x: 38.8, y: 20, w: 19, h: 10.5, label: "Needs completing - the half-built records" },
      },
      {
        src: "/guide/onboarding-wizard.png",
        caption:
          "Add someone: name and phone are enough to start. The six stages are shown across the top.",
      },
    ],
    steps: [
      "“In flight” groups every person by the step they have reached - new lead, call booked, said yes, agreement signed, enrolled, in a cohort, in class. The step is worked out from what is actually recorded against them, so it is never out of date and nobody has to remember to update it.",
      "Each row shows the one thing to do next and a “Go there” link straight to the screen that does it. You do not need to know which section that is.",
      "“Needs completing” is the important tab. A student record can be created six different ways - including by recording a payment in Finance - and three of them leave the person with no programme, no cohort and no login. This lists exactly those, and what each is missing.",
      "“Stuck” is anyone still being onboarded with nothing recorded against them for ten days or more.",
      "Open anybody's name to see their full journey on their own record, with the same ticks and the same next step.",
    ],
    tip: "Nothing on this screen stores anything of its own - it reads the same records as Contacts, Students, Agreements and Batches. So a step cannot be ticked here and wrong somewhere else.",
  },
  {
    section: "console", icon: "🎛️", title: "Founder Console", href: "/console",
    what: "The rules of the app itself - sections, the XP engine, goals and rewards. Admin-only.",
    shots: [
      {
        src: "/guide/console-not-armed.png",
        caption:
          "The founder console. System → Not armed lists every engine that is switched off.",
      },
    ],
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
    section: "improvements", icon: "📣", title: "Improvements", href: "/improvements",
    what: "Everything people hit while using the app, with the screen and the context already attached. Admin-only to read; anyone can file one.",
    path: ["Sidebar", "Admin", "Improvements"],
    steps: [
      "Anyone can file one. The Suggest-an-improvement button sits in the top bar on every screen, for every role - telecallers, coaches, tutors and students included. It opens where they are, so nobody has to describe which page they were on.",
      "The reporter picks what kind of thing it is first, and the questions change to match. “A number looks wrong” asks what it shows and what it should show; “the rule should work differently” asks what the rule is now and why it is wrong. That is what stops a report arriving as “doesn't work”.",
      "Each report carries its own context, captured by the app rather than typed: the screen, the person's role and grants, the running build, and - the useful one - whether the engine behind that screen was switched OFF at the time. Most “this section does nothing” reports are answered by that line alone, before you read a word.",
      "Work the queue top to bottom: New → Triaged → Accepted → In progress → Fixed → Closed. “Fixed” means you shipped something; “Closed” means the person who reported it agrees. Anything you type as a resolution is shown to them.",
      "The numbers above the queue say how many are waiting, how many are blocking somebody's work, and how many were filed against a screen whose engine was off.",
    ],
    tip: "Set the developer's address in Console → System → Improvements. Without it the queue still works and the bell still counts, but nobody is emailed - which is a working setup, not a broken one.",
  },
  {
    section: "activity", icon: "🛡️", title: "Activity Log", href: "/activity",
    what: "Every action anyone takes in the app, stamped with the exact time it happened. Admin-only.",
    steps: [
      "Feed answers “what's been happening” - every action grouped by day, newest first. Table answers “what exactly did Asma do at 3pm” - one row per action, timed to the second.",
      "Filter by who, section, action type or date range, or search for a person or record by name. Every filter lives in the address bar, so you can bookmark a view or paste the link to someone.",
      "The engines log their own work under their own name - “Reminder engine”, “Booking engine” - with a cog instead of a face. If the automation messaged 40 leads overnight, that is what you will see; it is never filed under whoever last pressed “Run now”. Pick an engine in the Who filter to read only what ran on its own.",
      "Every time is IST, and always exact. The “12m ago” next to it is only a convenience - the real timestamp never moves.",
      "“Details” on a row opens what actually changed: the value before and the value after.",
      "The log only holds what happened after it was switched on. It cannot reconstruct history from before that.",
    ],
    tip: "Nothing here can be edited or deleted - not by a telecaller, not by you, not from the database. That is the point: a log its subjects could tidy up would be worth nothing.",
  },
  {
    section: "finance", icon: "💰", title: "Finance", href: "/finance",
    what: "Daily money picture - income, expenses, profit, receivables. Admin-only.",
    shots: [
      {
        src: "/guide/finance-income.png",
        caption:
          "Finance. When something that should post to the books is switched off, the screen says so rather than quietly leaving a gap.",
        hotspot: { x: 18.8, y: 25.5, w: 79, h: 10.5, label: "An engine that is switched off" },
      },
    ],
    steps: [
      "Enter every payment received under the Income tab (INR, EUR, or both - FX is stamped automatically).",
      "Enter expenses daily; tick “Is this COGS?” for direct delivery costs like Karthick's salary or Skool.",
      "For instalment students, add a Pending Payment with the agreed total - “paid so far” sums itself from income entries.",
      "Overdue rows turn red on their own. Metric cards at the top are always this-month, auto-calculated.",
      "Commission tab: each student-linked payment splits automatically - 5% when one person did both calls, 3% each when first call and discovery were split.",
    ],
    tip: "Link income entries to a student (optional dropdown) - that powers total paid and the commission report.",
  },
  {
    section: "pipeline", icon: "📞", title: "Pipeline", href: "/pipeline",
    what: "Every lead from first contact to Won, plus the monthly target bar.",
    shots: [
      {
        src: "/guide/pipeline.png",
        caption:
          "Pipeline: the funnel, its targets and the call outcomes.",
      },
    ],
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
    what: "Your numbers for today, once per day, before the day's deadline - most of them counted for you.",
    steps: [
      "Fields tagged “Auto” are already counted from what you did in the app today - check them, correct anything that reads wrong, add your notes and blockers, and submit. Notes are never auto-filled.",
      "Discovery Specialist: calls completed, highly qualified and no-shows come from the discovery outcomes you entered today; proposals from your stage moves to Proposal sent; follow-ups from the calls you marked “follow-up needed”.",
      "Appointment Setter: leads contacted, appointments set and pipeline adds are counted for you - follow-up messages have no record anywhere, so that one is always typed by hand.",
      "Delivery Coach: sessions delivered counts every enrollment whose last session date is today, at-risk flags counts the students you turned red today. Check-ins and assignments reviewed have no source at all - always type those.",
      "One log per day. With the end-of-day rules on, the day closes at the cutoff Admin sets in Console (9:00 PM by default) and no new log can be started after it; the page always shows the deadline you're working to. Corrections go through Admin.",
      "Miss that cutoff and the end-of-day job saves what your activity showed, stamped auto-saved rather than submitted by you. It is incomplete by construction - anything it couldn't see is left blank, never zeroed - so it stays open for you to amend (until the next day by default); fill in the rest and it becomes your own log and locks like any other.",
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
    section: "people", icon: "👥", title: "Users", href: "/people",
    what: "Team profiles, OKRs, daily-log board and user accounts. Admin-only.",
    steps: [
      "Daily logs tab: who logged today, the 7 PM missing badge, weekly totals per person.",
      "OKRs tab: set max 3 per person per month; circles go green/amber/red on completion %.",
      "Team & org chart: profile cards, display-only chart, reorder with arrows.",
      "Users & access → Invite user: pick a role as a starting preset, then adjust two separate things. MODULES are what they can see; CAPABILITIES are what they can change. A head coach can read Finance without being able to post to the ledger.",
      "You'll get a single-use invite link to send them - they set their own password, and nobody else ever sees it. Minting a new link kills the old one.",
      "Suspend signs a person out immediately and blocks them from signing in again; Reactivate undoes it. Delete removes the login for good - the work they recorded stays.",
    ],
    tip: "Grant “Manage team & access” to delegate seat management. A delegate can never mint an Admin, edit an Admin, edit their own row, or hand out a capability they don't hold themselves.",
  },
  {
    section: "students", icon: "🎓", title: "Students", href: "/students",
    what: "Every B2 student, their 90/120-day journey, signals, satisfaction and total paid.",
    shots: [
      {
        src: "/guide/students.png",
        caption:
          "Students, with the 90/120-day tracker.",
      },
    ],
    steps: [
      "Create a student when they pay - duration and end date derive from the program level.",
      "The tracker lists active Guided/Elite students: day number, milestone, signal dot, days since session.",
      "Open a student to update the tracker after each session; milestone and signal changes are logged forever.",
      "Generate the sprint plan on a Guided/Elite enrollment (13 or 18 weeks), set weekly targets, and record the weekend check-in as Achieved or Missed.",
      "The Early-warning radar on top flags drifting students - missed sprint weeks show up here too.",
    ],
    tip: "Upgrades = add a second enrollment on the same student; total paid sums across all of them.",
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
    section: "dashboard", icon: "🏠", title: "Dashboard", href: "/dashboard",
    what: "Your home page: what is on next, what you still owe, how you are doing, and where everything lives.",
    steps: [
      "“Next class” is the first thing on the page, with the Join button. It appears an hour before the class starts.",
      "“To do” gathers every piece of coursework you have not ticked off, from every class - so you do not have to go hunting through the timetable for them.",
      "“Your progress” shows your attendance, your coursework and your applications side by side. The bars only appear once there is something real to count.",
      "If your coach has set a sprint target for this week, it shows here with the deadline for your check-in.",
      "“Your resources” lists the material for your batch. Everything class-by-class is on My Classroom.",
    ],
    tip: "This page never holds anything the other two do not - it is a summary with links. If a number looks wrong, open My Journey or My Classroom and you will see the same number with the detail behind it.",
  },
  {
    section: "classroom", icon: "📅", title: "My Classroom", href: "/classroom",
    what: "Your timetable: every class, when it runs, the link to join it, the recording afterwards and the coursework you were set.",
    steps: [
      "“Next up” at the top is the one thing you need before a class - the topic, the time and the Join button. It appears an hour before the class starts.",
      "Below it your programme is laid out week by week, exactly as your agreement describes it. Each card shows the day, the time in IST and how long it runs.",
      "Sessions marked “Video (pre-rec)” have no fixed time. Watch them whenever you like from the date shown - they are part of the programme, not an extra.",
      "After a live class, the recording appears on its card. Tick off the coursework under each session as you do it; your coach sees it the moment you do.",
      "Your attendance and coursework bars only appear once there is something to count - an empty bar on day one would be telling you off for nothing.",
      "If your coach opens attendance during a class, an “I'm here” card appears here and on your dashboard with a countdown. Tap it while you are in the class - once the countdown runs out, your coach marks the register by hand.",
      "“Attendance pending” on a class means your coach has taken the register but not shared it yet. It is not an absence, and it does not count against you until it is shown.",
      "If you miss a class, watch its recording - you will get a nudge here and on your dashboard if you have not. Some recordings have a time limit set by your coach; the card shows how long is left, and says so plainly once it has gone.",
    ],
    tip: "Missed a class? Open its card - the recording is the make-up, any coursework set in it is still waiting for you, and the resources for that class are on the same card.",
  },
  {
    section: "coaching", icon: "🏫", title: "My Teaching", href: "/coaching",
    what: "Your week in front of a batch: what you are teaching next, the registers you owe, the recordings to post and the students you coach.",
    shots: [
      {
        src: "/guide/coaching.png",
        caption:
          "My Teaching - your cohorts, your classes and your students.",
      },
    ],
    steps: [
      "“This week” is every class you are running in the next seven days, with the link to start it.",
      "“To mark” is every class you have already taught but not yet marked. Take the register from there - attendance is what the drop-risk signal is built on, so an unmarked class makes a student look fine when they are not.",
      "After a class, post the recording from its card. It attaches to that session, so a student who missed it finds the video inside the class they missed.",
      "“Set coursework” assigns a task to the whole batch at once, and it shows up in every student's classroom.",
      "“My students” is your own caseload - attendance, outstanding coursework and whose sprint check-in has gone past its week. It is sorted worst-first, so the top of the list is where to look.",
      "Resources: open a batch and use the Resources tab to post material - a link for the whole cohort, or one for a single class. Untick “Students can see this” to write it now and release it after the class.",
    ],
    tip: "The desk only ever shows cohorts you run and students assigned to you. If a batch is missing, ask the founder to put you on it as the coach.",
  },
  {
    section: "attendance", icon: "✅", title: "Attendance", href: "/attendance",
    what: "Taking the register, in the two minutes it should actually take: open it in class, let the room mark itself, then correct what is left.",
    shots: [
      {
        src: "/guide/attendance.png",
        caption:
          "The register desk: what is open now, what was never marked, and what has not been shown to students.",
      },
    ],
    steps: [
      "Find today's class and press “Open attendance”. Pick how long to keep it open and how long still counts as on time - the defaults come from Console, so most of the time you just confirm.",
      "Every student on that cohort's roster now sees an “I'm here” button with a countdown, on their dashboard and in their classroom. Their arrivals appear on your board as they land.",
      "You can close the window early once the room is complete, and “Rest absent” marks everyone who never checked in. Students who already have a mark are left alone.",
      "Open the register itself to change any row by hand. A row the student ticked says so, with the time they arrived, so you can see which marks are yours and which are theirs.",
      "“Show to students” is a separate press, and that is deliberate: when a window closes, the register is a list of everyone who did not press a button. Fix it first - excuse whoever emailed in sick - and then show it.",
      "Lateness counts from whichever is later, the class start or the moment you opened the window. So opening early never makes anyone late, and opening late never penalises the room.",
      "“Not caught up” lists students who missed a class and still have not watched its recording 24 hours after it went up. It is grouped by class, because the usual cause is one thing - a missing recording, or a viewing window that closed - rather than six separate students.",
      "The percentage shown is what we TRACKED, not what they ticked. Somebody who marked it watched at 40% still appears, labelled “disputed” - which is what lets you have that conversation without it becoming an argument.",
      "Two rows on that list are yours rather than theirs: “No recording” means the video was never posted, and “Window closed” means the viewing time ran out before they watched it. Post it, or reopen the window, straight from the row.",
      "Publishing a register is also what tells the absent students. Until you press “Show to students”, nobody is notified and nobody is chased - so take your time correcting it.",
      "To find out WHY somebody missed a class, open the register and press “Ask why” on their row. Nothing is asked of a student unless you do - there is no standing “why were you away?” box, because a form on every absence is one nobody fills in. Their answer comes back on the same row, with “Excuse” beside it.",
    ],
    tip: "“Never marked” and “Not shown to students” are your two to-do lists. The first is a class with no record at all - it makes a student who missed it look fine. The second is a record the batch cannot see yet.",
  },
  {
    section: "leaderboard", icon: "🏆", title: "Leaderboard", href: "/leaderboard",
    what: "One board across the four taught weeks and the 90/120-day sprint - attendance, coursework, applications, recruiter connections and interviews, scored together.",
    steps: [
      "Most of it counts itself. Classes you attended, recordings you finished, coursework you ticked, applications in your tracker and sprint weeks your coach marked achieved all feed the board without anyone typing them in.",
      "“Your sprint log” is for the few things the app cannot see: a German HR contact accepting your connection, an application somebody actually read, an interview you secured, a win worth sharing. Log those and your place moves straight away.",
      "Put the day it ACTUALLY happened, not today. If you are catching up on a week of connections you can log them as one entry with a quantity - but there is a weekly limit, so a big number does not buy a big jump.",
      "Tap your own row to see exactly how the total was built. You cannot open anybody else's: the total is the board, the working behind it is theirs.",
      "A recording you ticked as watched but only got 40% through does not count. The tracked percentage is what scores, which is also what your coach sees.",
      "Equal scores share a place - two students on the same total are both second, and the next is fourth.",
    ],
    tip: "Your coach can correct or remove anything you log, and will see that you logged it. Log what happened and the board takes care of itself.",
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
    section: "funnel", icon: "⏬", title: "Funnel Report", href: "/funnel",
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
      "Runway = cash ÷ average of the last few months' expenses; the window and the green/amber/red bands are set in Console → Cash targets (they ship as 3 months, ≥6mo green, 3-6 amber, <3 red).",
      "Receivables auto-pull from Finance pending payments - never enter them twice.",
      "Payables hold fixed costs; their monthly total is your break-even revenue line.",
    ],
    tip: "The runway badge in the top bar follows you on every screen - click it to jump here.",
  },
  // ─────────────────────── Sales: the lead → deal half of the journey ───────────────────────
  {
    section: "contacts", icon: "📇", title: "Contacts", href: "/contacts",
    path: ["Sidebar", "Sales", "Contacts"],
    what: "Everyone who has ever enquired, with their phone number, where they came from and who owns them.",
    shots: [
      {
        src: "/guide/contacts.png",
        caption:
          "Contacts - everyone who has ever enquired.",
      },
    ],
    steps: [
      "“Add contact” needs a name and a phone number. Everything else can be filled in later - do not hold up entry for a city or an industry.",
      "Typing somebody who already exists is refused, not duplicated: the phone number and the email are both checked, and you are told whose record it clashes with. Open that record instead.",
      "Every new contact is handed to a telecaller automatically, by the same rotation the website uses, so nobody lands as “Unassigned”.",
      "Open a contact to log a call, read their history, and see their onboarding journey - the strip that says which step they are on and what to do next.",
      "Companies, Tasks and Custom fields are the other tabs. Custom fields add your own questions (visa type, target country, budget) to every contact.",
    ],
    tip: "Deleting a contact archives it rather than erasing it, and re-entering the same person later restores the original record with its history intact.",
  },
  {
    section: "bookings", icon: "📆", title: "Bookings", href: "/bookings",
    path: ["Sidebar", "Sales", "Bookings"],
    what: "Every discovery call booked, and the calendar of slots prospects can book into.",
    shots: [
      {
        src: "/guide/bookings.png",
        caption:
          "Bookings, and the discovery-call calendar behind them.",
      },
    ],
    steps: [
      "Slots are not typed in one at a time. You save a weekly pattern per person - which weekdays, which hours - at Console → Sales ops → Availability, and the app tops the calendar up every hour from it.",
      "If this screen shows four zeroes and an empty week, it is almost always because no availability pattern has been saved. The screen says so, with a link to the panel that fixes it.",
      "The public booking page is /book. The link at the top of this screen opens exactly what a prospect sees.",
      "Each booking carries its own confirm-or-cancel state. Switching that engine on (Console → Sales ops) asks the prospect to reply YES, and releases a slot nobody confirmed instead of holding it through the no-show.",
      "Zoom links are created, moved and deleted with the booking when that engine is armed - a call whose time changes gets a new link automatically.",
    ],
    tip: "A booking is the evidence for the “Call booked” step on somebody's onboarding journey. Book it here and their journey moves on its own.",
  },
  {
    section: "opportunities", icon: "🗂️", title: "Deals", href: "/opportunities",
    path: ["Sidebar", "Sales", "Deals"],
    what: "The drag-and-drop board of live deals, one card per person, one column per stage.",
    shots: [
      {
        src: "/guide/deals-board.png",
        caption:
          "The Deals board - one card per person, dragged between stages.",
      },
    ],
    steps: [
      "Drag a card to move the deal. The person's own stage moves with it, so Pipeline and this board always agree - they are two views of one thing, not two records.",
      "This is the same set of people as Pipeline. Pipeline is the funnel with its numbers, targets and call outcomes; Deals is the board you push cards across.",
      "A card only appears here if a deal exists for that person. New leads are put on the board automatically only when that engine is armed (Console → Sales ops → Operations) - until then, work from Pipeline and Contacts.",
      "Archived cards are under their own heading at the bottom, and can be restored.",
    ],
    tip: "Called “Opportunities” in older notes and still gated on that name internally. Only the label changed.",
  },
  {
    section: "outreach", icon: "📣", title: "Outreach", href: "/outreach",
    path: ["Sidebar", "Sales", "Pipeline", "Outreach queue"],
    what: "The 23-step outreach script as a working queue - who to message, what to say, and who has gone quiet.",
    steps: [
      "It is off the sidebar on purpose, because it belongs to Pipeline: open it from the “Outreach queue” link at the top of that screen.",
      "The queue is worked top down. Each row is one person at one step of the script, with the message to send already written.",
      "“Already breached” and “Approaching” are speed-to-lead: a new lead that has gone past the five-minute SLA, and one about to. Those two lists are the whole job on a busy morning.",
      "Key Metrics is the sheet the script feeds - contacted, replied, booked, by day.",
      "The ladder only advances by itself while the scheduled jobs are running. If nothing is moving, check Console → System → Not armed before suspecting the queue.",
    ],
    tip: "Messages reach real phone numbers as soon as WhatsApp is switched on. Check Console → System → Not armed if you are unsure whether sending is live.",
  },

  // ─────────────────────── Students: the contract → cohort half ───────────────────────
  {
    section: "agreements", icon: "✍️", title: "Agreements", href: "/agreements",
    path: ["Sidebar", "Students", "Agreements"],
    what: "Coaching contracts: drafted here, signed by the client on their phone, countersigned and filed.",
    shots: [
      {
        src: "/guide/agreements.png",
        caption:
          "Agreements, grouped by where each one actually is.",
      },
      {
        src: "/guide/agreement-new.png",
        caption:
          "Drafting one: the template, the client, the programme and the cohort.",
      },
    ],
    steps: [
      "“New agreement” starts from a template, picks the contact, and fills in the programme, the fee and the batch. A guessed value is flagged rather than silently used - you confirm it before anything goes out.",
      "Send it and the client gets a link and a signing code on WhatsApp. They sign on their phone; you see the status change here.",
      "The list is grouped by where each agreement actually is: sent but not opened, opened but not signed, signed, declined, voided. That status is worked out from the document itself, so it is never stale.",
      "A signed agreement does NOT create a student by itself - that is deliberate, because the programme level and coach are not known at signing. The signed agreement carries the button that creates them, and Onboarding → Needs completing lists anybody who was missed.",
      "Chasing an unsigned agreement is an engine you switch on at Console → Delivery & team → Agreements. Until you do, nobody is chased and a quiet contract stays quiet until its link expires.",
    ],
    tip: "An expired link cannot be re-opened. Void the agreement and issue a fresh one - the history of both is kept.",
  },
  {
    section: "batches", icon: "📚", title: "Batches & Plans", href: "/batches",
    path: ["Sidebar", "Classroom", "Batches & Plans"],
    what: "Every cohort for both businesses, and the week-by-week plans they are taught from.",
    shots: [
      {
        src: "/guide/batches.png",
        caption:
          "A cohort reads Draft until it has a plan, a teacher and a learner - and says which of those is missing.",
        hotspot: { x: 19, y: 40, w: 34, h: 9, label: "Draft, and what it still needs" },
      },
    ],
    steps: [
      "Three tabs: coaching cohorts, German Note cohorts, and the plans. A cohort belongs to exactly one business and can only seat the levels that business teaches.",
      "A new cohort reads “Draft” until it has a plan, a teacher and at least one learner. Open it and the setup checklist names what is missing, with a link to each remedy - and “Start cohort” stays disabled, with the reason on it, until all three are in place.",
      "Open a cohort to work on it: Timetable builds every dated class from a plan in one go, and Roster adds learners - as many at once as you like, from the cohort itself.",
      "Plans are written once and reused. Week number, topic, duration, day and time - the same sheet the founders already kept, with the dates worked out per cohort.",
      "Closing a cohort is “Archive”, not delete. Archiving keeps the roster, the classes and the recordings readable; deleting is only possible while a cohort is still empty.",
    ],
    tip: "“Draft” is worked out from the cohort, never stored. Fill in the missing thing and it changes by itself - there is no status to remember to update.",
  },
  {
    section: "programs", icon: "🎚️", title: "Programs", href: "/programs",
    path: ["Sidebar", "Admin", "Programs"],
    what: "The catalogue: which programmes and levels exist, what each costs, and the plans they are taught from.",
    steps: [
      "Programmes is the price list. A level with no price cannot be invoiced - the invoice form's programme picker reads this list, and an empty list is an empty picker.",
      "Each programme carries a rupee and a euro price. The euro one is what German Note quotes; they are two stored figures, never a conversion.",
      "Curriculum is where a plan is written: one row per session, with week number, topic, duration, day and time. A cohort's timetable is built from one of these.",
      "Switching a level off keeps every student and cohort already on it - it only stops new ones being created.",
    ],
    tip: "Adding a brand-new level (C1, C2) is more than a toggle: the code has to learn it too. Ask before promising one.",
  },

  // ─────────────────────── Money ───────────────────────
  {
    section: "payments", icon: "🧾", title: "Payments", href: "/payments",
    path: ["Sidebar", "Finance", "Payments"],
    what: "Invoices and estimates, the programme price list, and recurring plans. Admin-only.",
    shots: [
      {
        src: "/guide/payments.png",
        caption:
          "Invoices, estimates, the programme price list and recurring plans.",
      },
    ],
    steps: [
      "An invoice is drafted, then issued. Issuing is what draws its real number and locks it - a draft can still be changed, an issued invoice cannot.",
      "Pick the currency per invoice. Rupees and euros are separate prices, not a conversion, and tax is set per currency.",
      "Products is the programme price list. Nothing can be invoiced until the programme has a price - if the picker is empty, that is why.",
      "Receipts are issued against money actually received, and carry their own numbering.",
      "Chasing overdue instalments is an engine (Console → System → Alerts & Chasing). While it is off, an overdue balance ages here in silence and nobody is nudged.",
    ],
    tip: "The issuer block and tax ID on the invoice come from Console → Money → Invoicing. A German invoice is not valid without them.",
  },
  {
    section: "telecaller", icon: "🎖️", title: "Bonus & Commission", href: "/telecaller",
    path: ["Sidebar", "Finance", "Bonus & Commission"],
    what: "What each telecaller has earned - bonuses from targets, commission from payments they closed.",
    steps: [
      "Commission is worked out from payments that name a student: one rate when the same person took both calls, a split rate when the first call and the discovery call were different people.",
      "The rates are yours to set, at Console → Money → Commission. Changing a rate does not rewrite what has already been earned.",
      "Bonuses come from the monthly target on the telecaller board. The figure here is derived from work already recorded, so it cannot drift from the pipeline.",
      "Commission is reported here whether or not it has been posted to the books. Posting it to the ledger is a separate engine at Console → System → Maintenance.",
    ],
    tip: "A payment with no student linked earns nobody commission. Linking the student on the income entry is what makes it count.",
  },

  // ─────────────────────── Marketing: how enquiries arrive ───────────────────────
  {
    section: "forms", icon: "📝", title: "Forms", href: "/forms",
    path: ["Sidebar", "Marketing", "Forms"],
    what: "Capture forms you can put anywhere. A submission lands straight in Contacts as a new enquiry.",
    steps: [
      "Build the form, then use its public link - or embed it. Every submission becomes a contact, assigned to a telecaller by the usual rotation.",
      "A submission with no phone number is refused, because every later step (the call, the WhatsApp, the duplicate check) needs one.",
      "Submissions are deduplicated against existing contacts, so somebody filling the form twice does not become two people.",
      "Fields you add show up on the contact record alongside the standard ones.",
    ],
    tip: "Test a form by submitting it yourself with your own number. It will appear in Contacts within seconds, which is the fastest way to prove the whole chain works.",
  },
  {
    section: "funnels", icon: "🧲", title: "Funnels", href: "/funnels",
    path: ["Sidebar", "Marketing", "Funnels"],
    what: "Landing pages and multi-step funnels, hosted publicly, each one with its own booking page.",
    steps: [
      "Build the pages, publish, and share the public link. Nothing here is visible until you publish it.",
      "A funnel's booking step shows the same discovery-call calendar as /book - so if no availability pattern has been saved, the funnel shows an empty calendar too.",
      "Which funnel somebody came through is recorded on their contact, and shown in the attribution table on Reports.",
      "Editing a published funnel changes what the public sees as soon as you save.",
    ],
    tip: "An empty calendar on a funnel is almost never the funnel's fault. Check Bookings first.",
  },
  {
    section: "sites", icon: "🌐", title: "Website", href: "/sites",
    path: ["Sidebar", "Marketing", "Website"],
    what: "Public marketing pages with a shared header, footer and brand theme, published straight to the web.",
    steps: [
      "A website holds the pages, the navigation they share and the theme they all use. Create one, then add pages to it.",
      "The home page usually lives at /. Open a page to lay out its sections.",
      "Nothing is public until it is published, and a published page changes the moment you save it.",
      "The domain and the tracking pixel are set on the website, not per page.",
    ],
    tip: "The brand theme is set once on the website and inherited by every page, so a colour change is one edit rather than twenty.",
  },
  {
    section: "whatsapp", icon: "💬", title: "WhatsApp", href: "/whatsapp",
    path: ["Sidebar", "Marketing", "WhatsApp"],
    what: "The WhatsApp channel: whether sending is live, what has gone out, and which automatic messages are switched on.",
    shots: [
      {
        src: "/guide/whatsapp.png",
        caption:
          "WhatsApp: whether sending is live, what has gone out, and which automatic messages are on.",
      },
    ],
    steps: [
      "The top of the screen says whether sending is actually live. If it is off, nothing reaches anybody - the engines still run, they just talk to nobody.",
      "Every message the app has sent is listed with its delivery state. “Sent” means WhatsApp accepted it; delivered and read are reported back separately.",
      "Settings is where the automatic messages are switched on one at a time: the enrolment welcome, class reminders, confirm-or-cancel. Each needs its template approved first.",
      "A reminder can be set to rehearse rather than send. That is doing its job perfectly and still nobody is being reminded - the screen says when it is in that state.",
      "Stage messages is the editor for what goes out at each pipeline stage. It is reached from the link at the top of this screen.",
    ],
    tip: "Messages go to real numbers. There is no test mode switched on, so a message you send to try it out arrives on somebody's phone.",
  },
  {
    section: "conversations", icon: "📨", title: "Conversations", href: "/conversations",
    path: ["Sidebar", "Marketing", "Conversations"],
    what: "Email and SMS threads in one inbox, with reusable templates. Admin-only.",
    steps: [
      "Inbox holds every thread, WhatsApp included. A thread starts when you write to somebody from their contact record.",
      "Templates are reusable messages with {{name}} tokens filled in per person.",
      "Settings holds the email connection and the From address. Email is off until both are set, and until then every send is accepted and discarded.",
      "“Sent” means the email service accepted it. Delivery is reported separately, and only if the delivery webhook is configured.",
    ],
    tip: "If nobody is receiving email, check Settings here before anything else - a missing From address silently stops every send in the app, including password resets.",
  },

  // ─────────────────────── Your own work ───────────────────────
  {
    section: "my-desk", icon: "☎️", title: "My Desk", href: "/my-desk",
    path: ["Sidebar", "My Work", "My Desk"],
    what: "Your own calls, your own conversions and today's list - just the people assigned to you.",
    shots: [
      {
        src: "/guide/my-desk.png",
        caption:
          "My Desk - the people assigned to you, with whoever needs a call first.",
      },
    ],
    steps: [
      "The list is yours alone: the contacts assigned to you, with the ones needing a call first.",
      "Log the call from here. What you record is what moves the person's onboarding journey on - nobody has to update a status separately.",
      "Which version of this desk you see depends on your team profile, not your job title. If it looks like somebody else's desk, that is why.",
      "“No team profile linked to your login” means your account is not joined to a team record yet. Ask the founder to link it in Users → Team; until then this desk cannot know whose calls are yours.",
    ],
    tip: "Your numbers here are derived from calls already logged, so they cannot be edited directly - log the work and the figures follow.",
  },
  {
    section: "reports", icon: "📊", title: "Reports", href: "/reports",
    path: ["Sidebar", "Insights", "Reports"],
    what: "Pick a thing, a period and a field, and see how much, which way it is moving, and what sits behind the number.",
    steps: [
      "Choose what you are counting - contacts, deals or invoices - then how to group it and over what period.",
      "Every choice is in the address bar, so the link IS the saved report. Bookmark it, or paste it to somebody and they see exactly what you see.",
      "Click a number to see the records behind it rather than taking the total on trust.",
      "Campaign attribution shows which funnel or form each enquiry came through.",
    ],
    tip: "There is no “save report” button because there does not need to be one - the URL is the report. Keep the ones you use in your bookmarks.",
  },
  {
    section: "guide", icon: "📖", title: "App Guide", href: "/guide",
    path: ["Sidebar", "My Work", "App Guide"],
    what: "This page: a short how-to for every screen you can open, plus full walkthroughs of the jobs that cross several.",
    shots: [
      {
        src: "/guide/guide.png",
        caption:
          "This guide. You only see entries for screens your account can open.",
      },
    ],
    steps: [
      "You only see guides for the sections your account can actually open, so nothing here describes a screen you cannot reach.",
      "The walkthroughs at the top are the ones to read first - “Onboard a new student, start to finish” is the whole journey in order, with the click path for every step.",
      "Each entry starts with where the screen is, written as a breadcrumb, so you can find it without already knowing the app.",
      "Where there is a screenshot, the thing to click is boxed on it.",
    ],
    tip: "If a screen has no entry here, that is a gap in the guide rather than a feature you are missing. Say so and it gets written.",
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

/**
 * CROSS-SECTION WALKTHROUGHS.
 *
 * The first one is the reason this file grew a second export. "Onboard a new student" is the job
 * the business runs on and the one the founder said they could not follow: it touches Contacts,
 * Bookings, Pipeline, Agreements, Students, Finance and Batches, so no per-screen guide could
 * ever have described it, and seven of those nine screens had no guide entry at all.
 *
 * Written so that somebody who has never seen the app can do it from this page alone - every
 * step names where it happens before it says what to do.
 */
export const GUIDE_JOURNEYS: GuideJourney[] = [
  {
    key: "onboard-a-student",
    title: "Onboard a new student, start to finish",
    forRoles: ["ADMIN", "HEAD", "USER"],
    summary:
      "From a first enquiry to their first class. You do not have to remember this list - Onboarding shows every person's next step and takes you to it. This is here so you can see the whole shape of it once.",
    steps: [
      {
        n: 1,
        title: "Find the enquiry",
        where: ["Sidebar", "Students", "Onboarding", "In flight"],
        does:
          "New enquiries arrive on their own from the website, a funnel or a form - nobody types them in. They appear under “New lead”. If someone phoned in and is not here, add them from Contacts.",
      },
      {
        n: 2,
        title: "Contact them and book the discovery call",
        where: ["The person's row", "Go there"],
        does:
          "Log the call or message against them, then book the discovery call from the calendar. The Zoom link is created for you if that is switched on.",
      },
      {
        n: 3,
        title: "Record how the call went",
        where: ["Sidebar", "Sales", "Pipeline", "Discovery call outcomes"],
        does:
          "Write down the outcome. If they are a strong fit, whoever ran the call marks them Highly Qualified - that is the verdict the rest of the sequence keys off.",
      },
      {
        n: 4,
        title: "Mark the deal as won",
        where: ["Sidebar", "Sales", "Pipeline"],
        does: "Move them to Won once they have said yes. Onboarding will then prompt for the agreement.",
      },
      {
        n: 5,
        title: "Send the agreement",
        where: ["Sidebar", "Students", "Agreements", "New"],
        does:
          "Pick the client, the template and the cohort they are joining, countersign it, and send. They get a signing link by email and WhatsApp.",
      },
      {
        n: 6,
        title: "They sign",
        where: ["Nothing to do"],
        does:
          "You will see it on Onboarding the moment they do. If the link expires unsigned, Onboarding says so and offers to re-issue - the deal is not lost.",
      },
      {
        n: 7,
        title: "Enrol them",
        where: ["The signed agreement", "Enrol as a student"],
        does:
          "This creates their student record. Then set their programme level on that record - Solo, Guided or Elite. Until the level is set they count as not yet enrolled.",
      },
      {
        n: 8,
        title: "Take the payment, or set up a plan",
        where: ["Sidebar", "Finance", "Income"],
        does:
          "Record what they paid. If they are paying in instalments, add a pending payment with the agreed total instead and the plan tracks itself.",
      },
      {
        n: 9,
        title: "Put them in a cohort",
        where: ["Sidebar", "Classroom", "Batches & Plans", "the cohort", "Roster"],
        does:
          "Open the cohort and add them from its Roster tab - you can add several people at once. If the cohort is not ready to teach yet, its setup checklist says what is missing.",
      },
      {
        n: 10,
        title: "Give them their login",
        where: ["The student's record", "Create portal login"],
        does:
          "They get their email and a temporary password. Now they can see their timetable, join links, recordings and coursework - and the journey is complete.",
      },
    ],
  },
  {
    key: "start-a-cohort",
    title: "Start a new cohort and fill it",
    forRoles: ["ADMIN"],
    summary:
      "A cohort needs four things before it can teach anybody: a plan, a teacher, dates and at least one learner. The cohort's own page tracks all four, so you can do this across several sittings.",
    steps: [
      {
        n: 1,
        title: "Write the plan, or pick one that exists",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Plans"],
        does:
          "A plan is the week-by-week sheet: week number, topic, how long, which day and what time. Write it once and build any number of cohorts from it.",
      },
      {
        n: 2,
        title: "Create the cohort",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts"],
        does: "Give it a name, a level, a teacher and a start date. It starts as a draft.",
      },
      {
        n: 3,
        title: "Build its timetable",
        where: ["The cohort", "Timetable", "Build from a plan"],
        does:
          "This turns the plan into real dated classes from the start date. Re-time any individual class afterwards if a week slips.",
      },
      {
        n: 4,
        title: "Add the learners",
        where: ["The cohort", "Roster", "Add learners"],
        does:
          "Pick as many as you like at once. Only people who have enrolled on a matching programme and are not already in a cohort are offered.",
      },
      {
        n: 5,
        title: "Check the setup checklist",
        where: ["The cohort", "Cohort setup"],
        does:
          "When every item is ticked the cohort is ready. Anything still outstanding links straight to the place that fixes it.",
      },
    ],
  },
  {
    key: "money-in",
    title: "Take a payment and keep the books straight",
    forRoles: ["ADMIN"],
    summary:
      "What to do when money arrives, in the order that keeps the student's history, the commission and the books all correct. The trap here is a payment recorded against nobody - it still counts as revenue, but it earns no commission, shows on no student's record and leaves a half-built student behind.",
    steps: [
      {
        n: 1,
        title: "Know which business it belongs to",
        where: ["Sidebar", "Finance", "Income"],
        does:
          "Pick B2 or German Note before anything else. The form will not choose for you, and money filed to the wrong business comes out of the wrong profit figure - which is exactly how German Note revenue once ended up in B2's books.",
      },
      {
        n: 2,
        title: "Name who paid",
        where: ["The student box"],
        does:
          "Start typing and pick them from the list. Picking an existing student is what links the payment to their history and earns the telecaller their commission.",
      },
      {
        n: 3,
        title: "If they are new, tick the box deliberately",
        where: ["“Create a student record”"],
        does:
          "A name nobody recognises offers to create a student record. Read the name before you confirm - a typo creates a second student and burns a student number. The new record has a number and a payment and nothing else, so it appears on Onboarding → Needs completing until it has a programme and a cohort.",
      },
      {
        n: 4,
        title: "Record the amount in the currency it arrived in",
        where: ["Amount"],
        does:
          "Rupees, euros, or both. The exchange rate is stamped on at the time, so the figure never moves afterwards. Write euros carefully - €125.000,50 means a hundred and twenty-five thousand.",
      },
      {
        n: 5,
        title: "For instalments, record the plan rather than the payments",
        where: ["Sidebar", "Finance", "Pending payments"],
        does:
          "Add the agreed total once. “Paid so far” then adds itself up from the income entries, and the overdue dates look after themselves - you never have to keep two numbers in step.",
      },
      {
        n: 6,
        title: "Invoice if they need one",
        where: ["Sidebar", "Finance", "Payments", "Invoices & estimates"],
        does:
          "Draft it, check it, then issue it. Issuing draws the real invoice number and locks the document. A programme with no price cannot be invoiced, so the price list has to be filled in first.",
      },
      {
        n: 7,
        title: "Know which of the books are switched on",
        where: ["Sidebar", "Admin", "Console", "System", "Not armed"],
        does:
          "Commission, tutor fees and invoice receivables each post to the ledger only when their engine is armed. While they are off, the figures on the Finance screen are right and the ledger behind them is incomplete. The Finance screen says so at the top when that is the case.",
      },
    ],
  },
  {
    key: "run-a-week",
    title: "Run a week of classes",
    forRoles: ["ADMIN", "HEAD", "COACH", "TUTOR"],
    summary:
      "What a coach does between Monday and Friday: take the register, publish it, put the recording up and check who is falling behind. The one thing worth knowing in advance is that marking attendance and publishing it are two different acts, and only publishing tells anybody anything.",
    steps: [
      {
        n: 1,
        title: "See the week ahead",
        where: ["Sidebar", "Classroom", "My Teaching"],
        does:
          "Your cohorts, your classes and your students. If a cohort you run is not here, it has no teacher set on it - ask the founder to assign you on Batches & Plans.",
      },
      {
        n: 2,
        title: "Take the register",
        where: ["The class", "Register"],
        does:
          "Mark who came. Students can check themselves in during a window around the class if that is switched on, and you confirm what they marked rather than typing it all again.",
      },
      {
        n: 3,
        title: "Publish it",
        where: ["Register", "Publish"],
        does:
          "Marking is private; publishing is what makes the register count. It fires the absence notices and updates every attendance percentage. An unpublished register looks identical to a class nobody took.",
      },
      {
        n: 4,
        title: "Put the recording up",
        where: ["The class", "Resources"],
        does:
          "Add the recording link against the class. Tick that students may see it, or it stays internal. Access can be time-limited, which is how a catch-up window is enforced rather than trusted.",
      },
      {
        n: 5,
        title: "Check who is drifting",
        where: ["Sidebar", "Classroom", "My Teaching", "My students"],
        does:
          "Each student shows their sprint progress and whether they are concerning. Record the week's actual on their record - that is what the 90/120-day tracker reads.",
      },
      {
        n: 6,
        title: "Expect no reminders unless they are armed",
        where: ["Sidebar", "Marketing", "WhatsApp", "Settings"],
        does:
          "Class reminders only go out if that engine is switched on and sending for real. A reminder set to rehearse is doing its job perfectly and still nobody is being reminded - the Attendance screen says when that is the case.",
      },
    ],
  },
  {
    key: "first-morning",
    title: "A telecaller's first morning",
    forRoles: ["ADMIN", "HEAD", "USER"],
    summary:
      "Where to start on day one, and what the two screens you will live in actually do. Everything you record moves the person's journey by itself - there is no status to update separately, and no form to fill in twice.",
    steps: [
      {
        n: 1,
        title: "Start at your own desk",
        where: ["Sidebar", "My Work", "My Desk"],
        does:
          "This is your list: the people assigned to you, with whoever needs a call first at the top. If it says no team profile is linked to your login, ask the founder to link it - until then the desk cannot know whose calls are yours.",
      },
      {
        n: 2,
        title: "Call, and log it while you are on the phone",
        where: ["A person's row", "Log call"],
        does:
          "Record what happened as you go. That log is the evidence that moves them from “New lead” to “Contacted” - nothing else needs touching. Calls made offline are kept and sync later with the time you actually made them.",
      },
      {
        n: 3,
        title: "Book the discovery call",
        where: ["Sidebar", "Sales", "Bookings"],
        does:
          "Pick a free slot. If the calendar is empty, no availability pattern has been saved yet - that is a founder setting, not something you can fix from here.",
      },
      {
        n: 4,
        title: "Work the outreach queue",
        where: ["Sidebar", "Sales", "Pipeline", "Outreach queue"],
        does:
          "The script, as a list, with the message already written for each person. “Already breached” is anyone who has gone past the five-minute response target - start there.",
      },
      {
        n: 5,
        title: "Watch your own numbers",
        where: ["Sidebar", "My Work", "My Daily Log"],
        does:
          "Your calls, conversions and targets, worked out from what you have logged. You cannot edit the figures - you log the work and the figures follow, which is why nobody can be behind on paperwork here.",
      },
      {
        n: 6,
        title: "When you do not know where something is",
        where: ["Sidebar", "My Work", "App Guide"],
        does:
          "Every screen you can open has a short how-to with the click path at the top of it. You only see guides for screens your account can actually reach.",
      },
    ],
  },
  {
    key: "arm-the-app",
    title: "Switch the app on: what to arm before you rely on it",
    forRoles: ["ADMIN"],
    summary:
      "Almost every automatic thing in this app ships switched OFF, on purpose - nothing should spend money or message a client because it was installed. The cost of that choice is that a feature which is built, off and unmentioned looks exactly like a feature that is broken. This is the order to switch them on in, and how to tell what is still off.",
    steps: [
      {
        n: 1,
        title: "Read the one list that knows",
        where: ["Sidebar", "Admin", "Console", "System", "Not armed"],
        does:
          "Sixteen engines, each with what is NOT happening while it is off and exactly where to switch it on. Anything you think is broken should be checked against this list first - most “broken” reports have turned out to be an engine nobody armed.",
      },
      {
        n: 2,
        title: "Start with the clock",
        where: ["The scheduled jobs row"],
        does:
          "The scheduler is upstream of nearly everything else: the slot top-up, the outreach ladder, the chasing, the digests. If it is not ticking, switching anything below on changes nothing. This one is a server setting rather than an in-app switch.",
      },
      {
        n: 3,
        title: "Then availability, or nobody can book",
        where: ["Console", "Sales ops", "Availability"],
        does:
          "Save a weekly pattern per person - which weekdays, which hours. Until one exists there are no slots, so /book shows prospects an empty calendar and both telecaller desks look empty for want of anything to do.",
      },
      {
        n: 4,
        title: "Then the two channels",
        where: ["WhatsApp", "and", "Conversations", "Settings"],
        does:
          "WhatsApp and email each have to be switched on and configured. Until then every send is accepted and discarded - including password resets, which is the one that catches people out. Both reach real people the moment they are live.",
      },
      {
        n: 5,
        title: "Then the messages that go out by themselves",
        where: ["WhatsApp", "Settings"],
        does:
          "The enrolment welcome, class reminders and confirm-or-cancel, one at a time, each needing its template approved first. Switch them on one by one and watch the sent list - not all at once.",
      },
      {
        n: 6,
        title: "Last, the ones that touch money",
        where: ["Console", "System", "Maintenance"],
        does:
          "Commission, tutor fees and invoice receivables post to the ledger only when armed, and chasing only chases when armed. Leave these until the figures on screen look right to you, because arming them starts writing to the books.",
      },
      {
        n: 7,
        title: "Expect the screens to tell you",
        where: ["Any feature screen"],
        does:
          "A screen whose engine is off now says so at the top, with what is not happening and where to switch it on. You should not have to come back to the Console to find out why something is quiet.",
      },
    ],
  },
];
