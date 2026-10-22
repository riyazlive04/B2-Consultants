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
    section: "cv-check", icon: "🧾", title: "CV Studio", href: "/cv-check",
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
