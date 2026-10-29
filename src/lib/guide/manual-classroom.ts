import { consoleHref, type GuideManual } from "./manual-types";

/* Shared click paths, so the same Console panel is always named the same way. */
const C_DAILY = ["Sidebar", "Admin", "Founder Console", "Delivery & team", "Daily Targets"];
const C_GAME = ["Sidebar", "Admin", "Founder Console", "Delivery & team", "Gamification"];
const C_ALERTS = ["Sidebar", "Admin", "Founder Console", "System", "Alerts & Chasing"];
const C_BOARD = ["Sidebar", "Admin", "Founder Console", "System", "Leaderboard"];
const C_STOP = ["Sidebar", "Admin", "Founder Console", "System", "Why students stop"];
const C_PERSON = ["Sidebar", "Admin", "Founder Console", "Access", "Per-person rules"];
const C_SECTIONS = ["Sidebar", "Admin", "Founder Console", "Access", "Sections"];
const WA_SETTINGS = ["Sidebar", "Marketing", "WhatsApp", "Settings"];
const STAFF_DELIVERY: ("ADMIN" | "HEAD" | "COACH" | "TUTOR")[] = ["ADMIN", "HEAD", "COACH", "TUTOR"];

export const MANUAL_CLASSROOM: GuideManual[] = [
  // ------------------------------- My Daily Log -------------------------------
  {
    section: "daily-log",
    overview:
      "My Daily Log is where the head coach, coaches and tutors record their numbers for the day, once per day. Most numbers are counted for you from what you did in the app, so you check them, add what the app cannot see, and submit. Telecallers do not have this page by default: their day is counted from their calls on My Desk.",
    engines: ["cron"],
    features: [
      {
        id: "today-log",
        name: "Log today",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "The once-a-day form for your numbers, pre-filled from your activity wherever the app can count it.",
        use: [
          "Open My Daily Log. The date is fixed to today, in India time.",
          "Check every field tagged Auto. It was counted from what you did in the app today; correct it if it reads wrong.",
          "Type the fields marked Manual entry. The app has no record of them.",
          "Add anything that held the day back under Notes / blockers.",
          "Press Submit today's log.",
        ],
        logic: [
          "The fields you see depend on the log type on your team profile: Discovery Specialist, Appointment Setter or Delivery Coach.",
          "Delivery Coach: Sessions delivered counts every enrolment whose last session date is today, and Students flagged as at risk counts the students you turned red today. Students checked in on and Assignments reviewed have no record anywhere, so you always type them.",
          "Discovery Specialist: calls completed, highly qualified calls and no-shows come from the discovery call outcomes you entered today, proposals from your moves to Proposal sent, and follow-ups from outcomes marked follow-up needed.",
          "Appointment Setter: leads contacted, appointments set and leads added to the pipeline are counted. Follow-up messages sent is always typed.",
          "A field the app cannot see is left blank, never filled with zero, so 'not reported' never reads as 'did none'.",
          "One log per person per day. A second submit is refused, and you cannot write a log for another day.",
          "The fields that were auto-filled are remembered on the log, so history can show which numbers came from the app.",
        ],
        controls: [
          {
            setting: "A person's log type (which fields their form shows)",
            where: ["Sidebar", "Admin", "Users", "Team & org chart"],
            href: "/people?tab=2",
            who: ["ADMIN"],
            effect:
              "Changes the form from the next log. Logs already submitted keep the type they were written under.",
          },
        ],
        watchOut: [
          "With no team profile you see a message instead of the form. Admin creates the profile under Users, Team & org chart.",
          "Sessions delivered is not limited to your own students: it counts every enrolment whose last session date is today. Correct it before you submit if someone else ran some of them.",
          "A submitted log is locked. A mistake is fixed by Admin adding a correction note, not by editing.",
        ],
        shot: {
          file: "daily-log-today-log.png",
          route: "/daily-log",
          caption: "My Daily Log, with today's status at the top and the form below it.",
          highlight: { text: "Today's log", label: "Today's status" },
        },
      },
      {
        id: "deadline",
        name: "Deadline and auto-save",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "The end-of-day rules: when today's log closes, and what happens to a day nobody logged.",
        use: [
          "Read the Today's log tile: Pending, In, Auto or Closed.",
          "Submit before the deadline shown on the tile and above the form.",
          "If the tile says Auto, the end-of-day job saved your numbers for you. Fill in the blank fields on the amber form and press Confirm as my log.",
          "If it says Closed and nothing was saved, ask Admin.",
        ],
        logic: [
          "These rules ship switched off. While off there is no cutoff: the page and the reminder use a 7:00 PM convention, and the day still locks at midnight India time because a log is always stamped with today.",
          "Switched on, a reminder starts at the nudge time and no new log can be started after the cutoff.",
          "At the cutoff, auto-save writes a log for every active team member who has not logged (Admin excluded), using the same counts the form shows. Blank fields stay blank.",
          "An auto-saved log stays editable by its owner for the amend window. Confirming it makes it yours and locks it like any other log.",
          "An auto-saved day already counts as a log day for your streak and in the Arena, so confirming it adds no extra XP.",
          "Auto-save only happens if the scheduled jobs are running. The cutoff itself is checked against the real clock either way.",
        ],
        controls: [
          {
            setting: "Enforce end-of-day rules",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "Off",
            effect:
              "Applies from the next submit. Never touches logs already written. Switching it off removes the cutoff, the reminders and the ability to amend auto-saved logs.",
          },
          {
            setting: "Remind at and cutoff times",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "Remind at 6:00 PM, cutoff 9:00 PM (India time)",
            effect: "Read live on every submit and page load, so a new time applies to today straight away.",
          },
          {
            setting: "Auto-save at cutoff",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "On (only matters once the rules are enforced)",
            effect: "Decides whether tonight's run writes logs. Logs it already wrote stay.",
          },
          {
            setting: "Amend window (days)",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "1 day",
            effect:
              "Measured from each auto-saved log's date on every load, so it also applies to logs already saved. 0 makes auto-saved logs final.",
          },
          {
            setting: "EOD summary to me",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "On",
            effect: "After the cutoff, Admin's notifications report who logged and who did not. Changes nothing on anyone's log.",
          },
        ],
        watchOut: [
          "An auto-saved log is incomplete by design. Until its owner fills the blanks, any report that adds those fields up reads low.",
          "With the rules off, 'before 7:00 PM' is a convention only. Nothing closes at 7:00 PM; the day closes at midnight.",
        ],
      },
      {
        id: "streak",
        name: "Logging streak",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "Your run of consecutive days with a log, and your headline number this week against last.",
        use: [
          "Log every day to keep the chain alive. The bar shows how close you are to the next milestone.",
          "Read This week vs last to see whether your headline number is trending up.",
        ],
        logic: [
          "The streak counts consecutive calendar days with a log, ending today, or yesterday while today is still pending. Weekends are days too, so a missed Saturday breaks it.",
          "The bar's milestones are 7, 14, 30, 60 and 90 days.",
          "The Arena pays a streak bonus on the day a run reaches a milestone: 40, 90, 250, 450 and 700 XP by default.",
          "This week vs last adds up your headline metric (calls, appointments or sessions, by log type) over the last 7 days and compares it with the 7 days before. With nothing to compare it reads Building your baseline.",
        ],
        controls: [
          {
            setting: "Streak bonus ladder (days and XP)",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "7, 14, 30, 60 and 90 days paying 40, 90, 250, 450 and 700 XP",
            effect:
              "Rules are dated. A New version changes bonuses from its start date and leaves bonuses already paid alone. Editing the live version re-scores every day since that version began.",
          },
        ],
        watchOut: [
          "The milestones drawn on this page are fixed at 7, 14, 30, 60 and 90 days, even if the founder changes the bonus ladder.",
        ],
        shot: {
          file: "daily-log-streak.png",
          route: "/daily-log",
          caption: "The streak tile and the week-on-week comparison beside it.",
          highlight: { text: "Logging streak", label: "Your streak" },
        },
      },
      {
        id: "okrs",
        name: "My OKRs this month",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "Your objectives for the month, with a box to update your own progress.",
        use: [
          "Find each objective under My OKRs this month, above the log form.",
          "Type your current progress in Update progress, for example 62% or 31, and press Save.",
          "Read the colour: green from 80%, amber from 50%, red below.",
        ],
        logic: [
          "Admin sets each OKR and its target. You can only update the progress.",
          "Completion is your number divided by the target, capped at 200%. If Admin set a manual percentage, that wins.",
          "The OKRs on track tile counts objectives at 80% or more; the ring shows the average.",
          "In the Arena an OKR at 100% pays XP, and one closed at 80% or more at month end pays a smaller amount (120 and 60 XP by default).",
        ],
        controls: [
          {
            setting: "A person's OKRs and their targets",
            where: ["Sidebar", "Admin", "Users", "OKRs"],
            href: "/people?tab=1",
            who: ["ADMIN"],
            effect: "The percentage is worked out on every load, so a new target changes it straight away, current month included.",
          },
        ],
        shot: {
          file: "daily-log-okrs.png",
          route: "/daily-log",
          caption: "The OKR tile; your objectives and the progress box sit just below the quests.",
          highlight: { text: "OKRs on track", label: "OKRs at a glance" },
        },
      },
      {
        id: "quests",
        name: "This week's quests",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "The weekly goals the Arena scores on top of daily XP, tracked from your logs.",
        use: [
          "Check the progress bar on each quest card; it moves as you submit logs.",
          "Finish a quest by Sunday to bank its XP for that week.",
        ],
        logic: [
          "Weeks run Monday to Sunday, India time.",
          "Each quest adds up one daily-log field over the week, or counts your weekday logs. Only quests for your log type, or for everyone, appear.",
          "Defaults include Steady Week (log all five weekdays, 60 XP) and, for delivery coaches, Session Marathon (8 sessions, 80 XP).",
          "Each finished week is banked under the quest rules that were live at the end of that week.",
          "The card only shows for people on the Arena board; Admin and the head coach are not on it.",
        ],
        controls: [
          {
            setting: "Weekly quests (field, target, XP and who they apply to)",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "10 quests, one for everyone and three per log type",
            effect:
              "Rules are dated. A New version changes only weeks after its start date; editing the live version re-scores weeks since it began.",
          },
        ],
        shot: {
          file: "daily-log-quests.png",
          route: "/daily-log",
          caption: "This week's quests, counted from the logs you submit.",
          highlight: { text: "This week's quests", label: "Weekly quests" },
        },
      },
      {
        id: "history",
        name: "My log history",
        where: ["Sidebar", "My Work", "My Daily Log"],
        href: "/daily-log",
        what: "Your past logs as a timeline, each graded against your daily target.",
        use: [
          "Scroll down to My log history.",
          "Read the status on each entry and the line explaining it.",
          "Look for the amber flag on days whose notes read like a blocker.",
        ],
        logic: [
          "Each day is graded on its headline metric against your daily target, or against your own median over the last 14 days when no target is set.",
          "Standout day is 30% or more above the reference, On target is from 85% of it, Below par is under that, and Quiet day is zero.",
          "Notes that read like a blocker (stuck, delay, outage, no-show and similar words) get an amber flag.",
          "Grades are worked out when the page opens, never stored.",
        ],
        controls: [
          {
            setting: "Daily target per log type",
            where: C_DAILY,
            href: consoleHref("delivery", "daily-targets"),
            who: ["ADMIN"],
            default: "Discovery Specialist 5 calls, Appointment Setter 3 appointments, Delivery Coach 4 sessions",
            effect:
              "Re-grades every entry on the next load, past ones included. Set 0 to grade a type against each person's own recent median.",
          },
        ],
        shot: {
          file: "daily-log-history.png",
          route: "/daily-log",
          caption: "Your log history, with each day graded against your target.",
          highlight: { text: "My log history", label: "Past logs" },
        },
      },
    ],
    related: [
      { section: "arena", why: "Every log, streak day and quest here turns into Arena XP." },
      { section: "people", why: "Admin sets team profiles, log types and OKRs, and sees everyone's logs under Users." },
      { section: "my-desk", why: "Telecallers' own daily numbers live there, counted from their calls." },
      { section: "coaching", why: "The sessions a coach runs from My Teaching are what Sessions delivered counts." },
    ],
    faq: [
      {
        q: "I am a telecaller. Why is My Daily Log not in my sidebar?",
        a: "By default it is for the head coach, coaches and tutors. A telecaller's day is already counted from their calls on My Desk. Admin can switch it on for a role in Founder Console, Access, Sections, or for one person in their access settings under Users.",
      },
      {
        q: "I submitted a wrong number. Can I edit it?",
        a: "No. A submitted log is locked. Ask Admin to add a correction note to it from Users, Daily logs; the original stays as written.",
      },
      {
        q: "Why is a field blank instead of zero?",
        a: "Because the app has no record of it. Blank means nobody reported it, zero means none happened. Type the real number before you submit.",
      },
      {
        q: "Does an auto-saved day keep my streak?",
        a: "Yes. Any day with a log counts, including one the end-of-day job saved. Confirm it to fill in what the app could not see.",
      },
    ],
  },

  // ------------------------------- Arena -------------------------------
  {
    section: "arena",
    overview:
      "The Arena turns work already recorded elsewhere into XP, levels, weekly quests and badges. Nothing is typed in here: every number is recomputed from daily logs, pipeline moves, call outcomes, student milestones, rescues and OKRs. Team members with a team profile are ranked, except Admin and the head coach, who watch the board but are not on it.",
    features: [
      {
        id: "player-card",
        name: "Your player card",
        where: ["Sidebar", "My Work", "Arena"],
        href: "/arena",
        what: "Your level, XP, streak, rank this week and badge count in one card.",
        use: [
          "Open Arena; your card is on the left.",
          "Read your level and how much XP the next level needs.",
          "Check your streak, your rank this week and your badges earned.",
        ],
        logic: [
          "Your level comes from total XP against the level ladder: Newcomer at 0 up to Legend at 8,800 XP by default.",
          "Levels never go down. Raising a threshold later does not demote anyone who already reached that level.",
          "No card means your login has no team profile, or you are Admin or the head coach.",
          "XP is recomputed from the records, so new work can take up to two minutes to show.",
        ],
        controls: [
          {
            setting: "Level ladder (titles and XP thresholds)",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "10 levels, Newcomer at 0 XP to Legend at 8,800 XP",
            effect: "A higher bar applies only to people who have not reached that level yet. Nobody is demoted.",
          },
        ],
      },
      {
        id: "leaderboard",
        name: "Leaderboard",
        where: ["Sidebar", "My Work", "Arena"],
        href: "/arena",
        what: "The team ranked by XP for this week, this month or all time.",
        use: [
          "Pick This week, This month or All time at the top of the Leaderboard card.",
          "Read the podium for the top three, then the full table below it.",
          "Type in the filter box to find one player. Your own row is marked (you).",
        ],
        logic: [
          "Players are ranked by XP in the chosen period; a tie is broken by all-time XP.",
          "The week starts on Monday and the month is the calendar month, both in India time.",
          "Each piece of XP is dated on the day the work happened, and priced by the rules in force that day.",
          "The streak and badge columns are the same numbers each player sees on their own card.",
        ],
        controls: [
          {
            setting: "XP paid for each action",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "Daily log 20, call outcome 5 (+10 if highly qualified), deal won 100, deposit paid 60",
            effect:
              "Rules are dated. A New version prices work from its start date only; editing the live version re-prices every day since that version began, which can move the board.",
          },
        ],
        shot: {
          file: "arena-leaderboard.png",
          route: "/arena",
          caption: "The Arena leaderboard, with one period switch for the whole board.",
          highlight: { text: "All time", label: "Period switch" },
        },
      },
      {
        id: "quests",
        name: "Weekly quests",
        where: ["Sidebar", "My Work", "Arena"],
        href: "/arena",
        what: "Short weekly goals that pay bonus XP, tracked from daily logs.",
        use: [
          "Read your quest cards under Weekly quests, with progress for this week.",
          "Admin and the head coach see every player's quest board instead.",
          "Founders with no quests set get a link to add them in the Console.",
        ],
        logic: [
          "Each quest adds up one daily-log number over Monday to Sunday, or counts weekday logs.",
          "Only quests for your log type, or for everyone, are shown to you.",
          "A finished week is banked as XP on the day of your last log that week, under that week's quest rules.",
          "Quests read daily logs only. Pipeline moves and call outcomes earn XP but never move a quest.",
        ],
        controls: [
          {
            setting: "Weekly quests (field, target, XP and who they apply to)",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "10 quests, one for everyone and three per log type",
            effect:
              "Rules are dated. A New version changes only weeks after its start date; editing the live version re-scores weeks since it began.",
          },
        ],
        watchOut: [
          "Telecallers do not have My Daily Log by default, so their quests stay at zero unless the founder gives them the log or sets quests they can reach.",
        ],
        shot: {
          file: "arena-quests.png",
          route: "/arena",
          caption: "Weekly quests, with this week's progress on each card.",
          highlight: { text: "Weekly quests", label: "This week's quests" },
        },
      },
      {
        id: "badges",
        name: "Badge gallery",
        where: ["Sidebar", "My Work", "Arena"],
        href: "/arena",
        what: "Every badge, earned or not, with the rule that unlocks it.",
        use: [
          "Open Badge gallery; your own shelf is the first tab.",
          "Click another person's tab to see theirs.",
          "Hover a locked badge to read what unlocks it.",
        ],
        logic: [
          "A badge unlocks on the first day its rule was met, under that day's threshold, and never locks again.",
          "Badges count logs, streaks, deals won, proposals, discovery calls, highly qualified calls, appointments, leads contacted, sessions, milestone moves, offers, rescues, OKR hits and levels.",
          "A badge the founder switches off disappears from every gallery.",
        ],
        controls: [
          {
            setting: "Team badges (name, rule and threshold)",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "23 badges, from First Steps to Living Legend",
            effect: "A raised threshold applies to people who have not earned the badge yet. A badge already earned is never taken back.",
          },
        ],
        shot: {
          file: "arena-badges.png",
          route: "/arena",
          caption: "The badge gallery, one tab per player.",
          highlight: { text: "Badge gallery", label: "Badges" },
        },
      },
      {
        id: "recent-xp",
        name: "Recent XP and How XP works",
        where: ["Sidebar", "My Work", "Arena"],
        href: "/arena",
        what: "A feed of the latest XP across the team, and the scoring rules currently in force.",
        use: [
          "Read Recent XP for who earned what, and for which piece of work.",
          "Open How XP works at the bottom to see every value being paid today.",
        ],
        logic: [
          "The feed shows the latest 30 XP events across all players.",
          "By default: daily log 20, call outcome 5 (15 if highly qualified), student milestone moved forward 15 (offer +50, completion +35), red student turned green 50, OKR at 100% 120, and 8 to 100 XP for pipeline moves depending on the stage.",
          "A student milestone only pays when it moves forward; moving one back pays nothing.",
          "How XP works is built from the live rules, so it always matches what is actually being paid.",
        ],
        controls: [
          {
            setting: "Reset all gamification rules",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            effect:
              "Deletes every version the founder created and applies the original rules to all history. XP, levels and badges are recomputed.",
            reset: "This is the reset. There is no undo, so prefer adding a New version.",
          },
        ],
        shot: {
          file: "arena-recent-xp.png",
          route: "/arena",
          caption: "The XP feed, and the rules panel that explains every value.",
          highlight: { text: "How XP works", label: "The live rules" },
        },
      },
    ],
    related: [
      { section: "daily-log", why: "Daily logs drive log XP, streaks and every weekly quest." },
      { section: "pipeline", why: "Moving a lead into a paying stage earns XP." },
      { section: "students", why: "Moving a student's milestone forward, or turning a red student green, earns XP." },
      { section: "console", why: "Every XP value, level, badge and quest is set under Gamification." },
    ],
    faq: [
      {
        q: "Can I lose XP?",
        a: "XP is recomputed from the records every time, so if a record is removed its XP goes too. Rule changes made as a New version only affect work after their start date, and levels and badges never go back down.",
      },
      {
        q: "Why is the head coach not on the board?",
        a: "The Arena ranks the people who compete. Admin and the head coach are left out on purpose; they can still open the page and see everyone's quests.",
      },
      {
        q: "Do I get anything for XP?",
        a: "The founder can set reward rules in Founder Console, Delivery and team, Rewards. They are checked against the same history the Arena scores, and each payout waits for approval.",
      },
      {
        q: "Why do my quests stay at zero?",
        a: "Quests count daily-log numbers only. If you do not submit a daily log, or no quest matches your log type, nothing moves.",
      },
    ],
  },

  // ------------------------------- Dashboard (student) -------------------------------
  {
    section: "dashboard",
    overview:
      "Your home page. It shows what is happening next, what you still owe and how you are doing, with links to the pages that hold the detail. Nothing here is new information: every number is the same one My Classroom and My Journey show.",
    features: [
      {
        id: "check-in",
        name: "Attendance is open",
        where: ["Sidebar", "My Work", "Dashboard"],
        href: "/dashboard",
        what: "A live check-in button that appears only while your coach has the register open for your class.",
        use: [
          "When the card appears, join the class and tap I'm here before the countdown runs out.",
          "Once it lands you see Checked in with the time.",
          "If it says Marked by your coach, there is nothing to do.",
          "If a card says your coach asked why you missed a class, type one line and press Send.",
        ],
        logic: [
          "The card only appears while your coach has attendance open for your cohort. Most of the time it is not there at all.",
          "Checking in early in the window records you as present; after that you are recorded as late, which still counts as attending.",
          "Lateness is counted from whichever is later: the class start or the moment your coach opened attendance.",
          "You always see your own check-in straight away, even before your coach shares the register.",
          "The why-did-you-miss card only appears when your coach asks about that absence. If they excuse it, it stops counting against your attendance.",
        ],
        controls: [
          {
            setting: "How long check-in stays open, and how long still counts as on time",
            where: ["Sidebar", "Classroom", "Attendance"],
            href: "/attendance",
            who: STAFF_DELIVERY,
            default: "Open for 15 minutes, on time for the first 10",
            effect: "Set by your coach each time they open attendance, starting from the admin's default.",
          },
          {
            setting: "Let students check themselves in",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Set by the admin. Off, the button disappears for every student and your coach marks the register by hand.",
          },
        ],
      },
      {
        id: "next-class",
        name: "Next class",
        where: ["Sidebar", "My Work", "Dashboard"],
        href: "/dashboard",
        what: "Your next live class, in any of your cohorts, with the button to join it.",
        use: [
          "Check the day, the time (India time) and how long it runs.",
          "Press Join class to open the meeting.",
          "Press Timetable to see every class on My Classroom.",
        ],
        logic: [
          "This is the soonest live class still to come, across all your cohorts. Pre-recorded modules and cancelled classes are never shown here.",
          "The Join class button appears as soon as your coach has added the meeting link.",
          "If your coach has not set a time yet, it says time to be confirmed.",
        ],
        controls: [
          {
            setting: "Class dates, times, join links and cancellations",
            where: ["Sidebar", "Classroom", "My Teaching", "Cohorts"],
            href: "/coaching?tab=2",
            who: STAFF_DELIVERY,
            effect: "Set by your coach or the admin on your cohort's timetable. A change shows here the next time you open the page.",
          },
        ],
        shot: {
          file: "dashboard-next-class.png",
          route: "/dashboard",
          caption: "The student dashboard, with the next class at the top.",
          highlight: { text: "Next class", label: "Your next class" },
        },
      },
      {
        id: "to-do",
        name: "To do",
        where: ["Sidebar", "My Work", "Dashboard"],
        href: "/dashboard",
        what: "Every piece of coursework you have not ticked off, plus this week's sprint check-in and your batch material.",
        use: [
          "Tick each task as you finish it; it leaves the list.",
          "If a Sprint week card shows, press Submit your check-in and answer it on My Journey before the date shown.",
          "Open the links under Your resources, or press All class material for everything on My Classroom.",
        ],
        logic: [
          "The list gathers unfinished tasks from every class in every cohort you are in, so you do not have to hunt through the timetable.",
          "Your coach sees your tick the moment you make it.",
          "The sprint card shows only while one of your sprint weeks covers today. If no target is set yet it says so, and you can still check in.",
          "Only material your coach has made visible to students appears, up to five items here.",
        ],
        controls: [
          {
            setting: "Coursework set for your class",
            where: ["Sidebar", "Classroom", "My Teaching", "This week"],
            href: "/coaching",
            who: STAFF_DELIVERY,
            effect: "Set by your coach for the whole batch at once. It appears here the next time you open the page.",
          },
        ],
      },
      {
        id: "progress",
        name: "Your progress",
        where: ["Sidebar", "My Work", "Dashboard"],
        href: "/dashboard",
        what: "Your journey ring, attendance, coursework, applications and interviews, plus any paperwork still waiting on you.",
        use: [
          "Read the ring and your current milestone; press My Journey for the detail.",
          "Check the Attendance and Coursework bars.",
          "If Your paperwork says your agreement is waiting, open it and sign.",
        ],
        logic: [
          "Attendance is classes attended out of classes counted. Late counts as attended; an excused absence and a cancelled class are not counted at all.",
          "Only registers your coach has shared are counted, so a class still waiting to be shared does not count yet.",
          "The bars only appear once there is something to count. They are green from 75%, amber from 50% and red below.",
          "Applications and interviews come from your coach's tracker.",
          "Your payment plan, balance and receipts are on My Journey.",
        ],
        controls: [
          {
            setting: "Hide a register until the coach shows it",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Set by the admin. Applies at once to every register, past ones included. Off, every mark shows the moment your coach takes it.",
          },
        ],
        shot: {
          file: "dashboard-progress.png",
          route: "/dashboard",
          caption: "Your progress: journey, attendance, coursework, applications and interviews.",
          highlight: { text: "Your progress", label: "How you are doing" },
        },
      },
    ],
    related: [
      { section: "classroom", why: "Your full timetable, recordings and coursework class by class." },
      { section: "my-journey", why: "Your journey detail, sprint check-in, agreement and payments." },
      { section: "leaderboard", why: "Where you stand against your cohort." },
    ],
    faq: [
      {
        q: "The Join class button is missing.",
        a: "Your coach has not added the meeting link yet. It appears as soon as they do.",
      },
      {
        q: "My attendance percentage changed on its own.",
        a: "Your coach shared a register, excused an absence or cancelled a class. All three change the number, and only shared registers ever count.",
      },
      {
        q: "Where are my payments?",
        a: "On My Journey, under Your payment plan and Payments received.",
      },
    ],
  },

  // ------------------------------- My Journey (student) -------------------------------
  {
    section: "my-journey",
    overview:
      "My Journey is your scoreboard on the road to a job in Germany: your stage, journey XP, the seven milestones, your badges and your weekly sprint check-in. It also holds your agreement and your payment plan. German Note learners see their agreement and payments here; the journey part is for coaching programmes.",
    features: [
      {
        id: "journey",
        name: "Your journey",
        where: ["Sidebar", "My Work", "My Journey"],
        href: "/my-journey",
        what: "Your stage, journey XP, momentum and the seven milestones, with what to focus on now.",
        use: [
          "Read your stage title and how far along the seven milestones you are.",
          "Work the list under This stage first; it is what matters right now.",
          "Check Sessions, Applications and Interviews; each one adds to your XP.",
        ],
        logic: [
          "The ring fills by milestones only. Each milestone has a weight, and the ring is the share of that weight you have reached.",
          "Journey XP adds bonuses on top: 8 per session, 4 per application and 20 per interview by default.",
          "The stages are Explorer, Builder, Connector, Applicant, Interviewer, Offer Holder and Alumni.",
          "Momentum shows how recently something happened (a session or a new milestone): Hot within 7 days, Steady within 14, Cooling within 21, then Stalled. It is hidden when your programme is not active.",
          "Day X of 90 or 120 counts from your enrolment date.",
          "Your milestone, sessions, applications and interviews are updated by your coaching team on your record.",
        ],
        controls: [
          {
            setting: "Your milestone, sessions, applications and interviews",
            where: ["Sidebar", "Students", "Students"],
            href: "/students",
            who: ["ADMIN", "HEAD"],
            effect: "Updated by the head coach or the admin. Shows here the next time you open the page.",
          },
          {
            setting: "Milestone weights, stage titles, bonus XP and momentum days",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "Bonus 8 per session, 4 per application, 20 per interview; Hot 7, Steady 14, Cooling 21 days",
            effect: "Set by the admin. Your journey is always read against today's rules, so a change shows on your next visit.",
          },
        ],
        shot: {
          file: "my-journey-journey.png",
          route: "/my-journey",
          caption: "Your journey: stage, XP, milestones and the numbers that move them.",
          highlight: { text: "Interviews", label: "The numbers that add XP" },
        },
      },
      {
        id: "sprint",
        name: "Weekly sprint",
        where: ["Sidebar", "My Work", "My Journey"],
        href: "/my-journey",
        what: "Your week-by-week sprint targets and the weekend check-in.",
        use: [
          "Find the week chips W1, W2 and so on; the ringed chip is this week. Hover one for its dates and target.",
          "When a check-in is open, type what you got done and press Submit check-in.",
          "If a week closed without an answer it stays open. Fill it in and say what got in the way.",
        ],
        logic: [
          "Your coaching team creates the sprint plan (13 weeks for a 90-day programme, 18 for 120 days) and sets each week's target.",
          "If your target and your answer are both plain numbers about the same thing, the week is marked achieved or missed straight away. Otherwise it waits for your coach.",
          "One answer per week. After that it shows as received and with your coach for review.",
          "You cannot check in to a week that has not started.",
          "A week marked achieved also scores on the Leaderboard.",
        ],
        controls: [
          {
            setting: "Your sprint plan, weekly targets and verdicts",
            where: ["Sidebar", "Students", "Students"],
            href: "/students",
            who: ["ADMIN", "HEAD"],
            effect: "Set by the head coach or the admin on your record. A change shows here straight away.",
          },
        ],
        shot: {
          file: "my-journey-sprint.png",
          route: "/my-journey",
          caption: "The weekly sprint strip and this week's check-in.",
          highlight: { text: "Weekly sprint", label: "Your sprint weeks" },
        },
      },
      {
        id: "badges",
        name: "Badge case",
        where: ["Sidebar", "My Work", "My Journey"],
        href: "/my-journey",
        what: "Badges you earn as your journey moves, and the dates you reached each milestone.",
        use: [
          "Open Badge case to see what you have earned and what is still locked.",
          "Read Progress history for the date you reached each milestone.",
        ],
        logic: [
          "Badges unlock by themselves from your record: first application, 20 applications, first interview, 3 interviews, 10 sessions, reaching a milestone, bouncing back from red to green, and more.",
          "In the Zone shows only while your signal is green, so it can come and go.",
          "Badges are checked against today's rules, so if the admin changes a badge, your case can change too.",
        ],
        controls: [
          {
            setting: "Student badges",
            where: C_GAME,
            href: consoleHref("delivery", "gamification"),
            who: ["ADMIN"],
            default: "11 badges, from Fast Starter to Offer Champion",
            effect: "Set by the admin. Student badges are read against today's rules, so a change applies on your next visit.",
          },
        ],
        shot: {
          file: "my-journey-badges.png",
          route: "/my-journey",
          caption: "Your badge case, earned badges first.",
          highlight: { text: "Badge case", label: "Your badges" },
        },
      },
      {
        id: "agreement-payments",
        name: "Agreement and payments",
        where: ["Sidebar", "My Work", "My Journey"],
        href: "/my-journey",
        what: "Your signed agreement, your payment plan and every payment recorded from you.",
        use: [
          "Under Your agreement, press View or Download.",
          "Read Your payment plan for each instalment, what is paid and what is still due.",
          "Read Payments received for every payment recorded from you.",
        ],
        logic: [
          "Your agreement shows Signed with the date, or Awaiting your signature.",
          "Each instalment shows paid with its date, or due with its date, and overdue once the date has passed.",
          "Only your own records are shown; nothing about other students.",
        ],
      },
    ],
    related: [
      { section: "dashboard", why: "Your home page summarises this page and links back here." },
      { section: "classroom", why: "Your classes, recordings and coursework." },
      { section: "leaderboard", why: "Sprint weeks you hit score points there." },
    ],
    faq: [
      {
        q: "My ring did not move after a session.",
        a: "The ring only moves when you reach a new milestone. Sessions, applications and interviews add XP, not ring.",
      },
      {
        q: "My check-in says it is waiting for my coach.",
        a: "Your answer could not be scored automatically, usually because the target or your answer is in words. Your coach will mark the week.",
      },
      {
        q: "A week closed before I answered. Is it lost?",
        a: "No. It stays open for you to fill in. Say what got in the way; that is more useful to your coach than the number.",
      },
    ],
  },

  // ------------------------------- My Classroom (student) -------------------------------
  {
    section: "classroom",
    overview:
      "My Classroom is your timetable: every class, when it runs, the link to join, the recording afterwards, the material and the coursework you were set. It is the page to open before every class.",
    engines: ["classReminders"],
    features: [
      {
        id: "next-up",
        name: "Next up",
        where: ["Sidebar", "Classroom", "My Classroom"],
        href: "/classroom",
        what: "Your next live class at the top of the page, and the check-in card while attendance is open.",
        use: [
          "Read the topic, day, time (India time) and length.",
          "Press Join class to open the meeting.",
          "If an Attendance is open card is showing, tap I'm here while you are in the class.",
        ],
        logic: [
          "Next up is the soonest live class still to come, across all your cohorts. Pre-recorded modules and cancelled classes are skipped.",
          "Join class appears as soon as your coach has added the meeting link.",
          "The check-in card only shows while your coach has attendance open for your cohort.",
        ],
        controls: [
          {
            setting: "Class dates, times, join links and cancellations",
            where: ["Sidebar", "Classroom", "My Teaching", "Cohorts"],
            href: "/coaching?tab=2",
            who: STAFF_DELIVERY,
            effect: "Set by your coach or the admin. A change shows here the next time you open the page.",
          },
        ],
        shot: {
          file: "classroom-next-up.png",
          route: "/classroom",
          caption: "My Classroom, with your next class at the top.",
          highlight: { text: "Next up", label: "Your next class" },
        },
      },
      {
        id: "timetable",
        name: "Timetable",
        where: ["Sidebar", "Classroom", "My Classroom"],
        href: "/classroom",
        what: "Every class in your programme, laid out week by week.",
        use: [
          "Scroll by week. Each card shows the day, the time in India time and how long it runs.",
          "On a card marked Starting now, press Join class.",
          "For a Video (pre-rec) session, press Watch the module any time from the date shown.",
          "Press Timetable as PDF to print it, or Add to my calendar to put it on your phone.",
          "If you are in more than one cohort, switch cohorts with the tabs at the top.",
        ],
        logic: [
          "Weeks follow your programme plan. Classes with no week number sit in a Classes group at the end.",
          "A live class is tagged Starting now from an hour before it starts until it ends. The join button disappears once a class is over.",
          "A cancelled or postponed class stays on your timetable, struck through, with your coach's reason. It has no join button and does not count in your attendance.",
          "The PDF and calendar file carry no join links, because files get forwarded. Join links stay in the app.",
          "Your sprint dates show at the bottom; weekly targets and check-ins are on My Journey.",
        ],
        shot: {
          file: "classroom-timetable.png",
          route: "/classroom",
          caption: "Your timetable, week by week, with the printable and calendar versions.",
          highlight: { text: "Timetable as PDF", label: "Download or add to your calendar" },
        },
      },
      {
        id: "attendance",
        name: "Your attendance",
        where: ["Sidebar", "Classroom", "My Classroom"],
        href: "/classroom",
        what: "Your mark on each class, and your attendance and coursework bars for the cohort.",
        use: [
          "Read the pill on each past class: You attended, You joined late, You missed this or Excused.",
          "Check the Attendance and Coursework bars at the top of your cohort.",
        ],
        logic: [
          "Attendance pending means your coach has taken the register but not shared it yet. It does not count against you until it is shared.",
          "Not marked yet means no register was taken for that class. It does not count against you.",
          "Your percentage is classes attended out of classes counted. Late counts as attended; excused and cancelled classes are left out.",
          "Your own check-in always shows, shared or not.",
          "The bars only appear once there is something to count. Green from 75%, amber from 50%, red below.",
        ],
        controls: [
          {
            setting: "Hide a register until the coach shows it",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Set by the admin. Applies at once to every register, past ones included. Off, marks show the moment your coach takes them.",
          },
        ],
      },
      {
        id: "recordings",
        name: "Recordings, material and coursework",
        where: ["Sidebar", "Classroom", "My Classroom"],
        href: "/classroom",
        what: "The recording, the material and the tasks hanging off each class.",
        use: [
          "After a live class, press Watch the recording on its card.",
          "Watch the days-left pill on recordings with a time limit.",
          "Open the links under Resources on a class, or Your batch resources at the top.",
          "Tick each task under a class as you finish it.",
        ],
        logic: [
          "Some recordings have a viewing window set by your coach. The pill shows how long is left (red at 2 days or less), and the card says so plainly once it has closed.",
          "A recording counts as watched at 90% of tracked viewing. A tick on its own does not count.",
          "If you missed a class and have not watched its recording, you get a reminder in your notifications once the catch-up time has passed.",
          "Only material your coach has made visible to students appears.",
          "Coursework set before you joined is copied to you when you are seated in the cohort.",
        ],
        controls: [
          {
            setting: "How long a recording stays watchable",
            where: ["Sidebar", "Classroom", "My Teaching", "To mark"],
            href: "/coaching?tab=1",
            who: STAFF_DELIVERY,
            default: "No time limit, unless the admin sets a house default",
            effect: "Chosen by your coach for each recording. Each recording keeps the window it was given; a new default never re-dates one already posted.",
          },
          {
            setting: "Catch-up grace (hours)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "24 hours after the recording goes up",
            effect: "Set by the admin. Measured from when the recording was posted, not from the class.",
          },
        ],
      },
    ],
    related: [
      { section: "dashboard", why: "Your home page shows the next class and everything you still owe." },
      { section: "my-journey", why: "Weekly sprint targets and check-ins live there." },
      { section: "leaderboard", why: "Classes attended, recordings watched and coursework done all score points." },
    ],
    faq: [
      {
        q: "I missed a class. What do I do?",
        a: "Open its card. The recording is your catch-up, any coursework set in it is still waiting for you, and the material is on the same card.",
      },
      {
        q: "Why does my class say Attendance pending?",
        a: "Your coach has taken the register but not shared it yet. It is not an absence, and it does not count until it is shared.",
      },
      {
        q: "The recording says it is no longer available.",
        a: "Its viewing window has closed. Ask your coach; they can reopen it.",
      },
    ],
  },

  // ------------------------------- My Teaching -------------------------------
  {
    section: "coaching",
    overview:
      "My Teaching is the desk for everyone who stands in front of a batch: coaches, tutors, the head coach and the founder. It shows the week ahead, the registers you owe, your cohorts and the students you coach. It scopes itself: you see the cohorts you lead and the students assigned to you, while the founder, the head coach and anyone allowed to seat students see every active cohort.",
    engines: ["classReminders"],
    features: [
      {
        id: "summary",
        name: "Desk summary",
        where: ["Sidebar", "Classroom", "My Teaching"],
        href: "/coaching",
        what: "Four counts across the top, and a warning when registers are marked but not shown to students.",
        use: [
          "Read Active cohorts, Students in them, Registers to take and Recordings to post.",
          "Click a count to see the cohorts or classes behind it.",
          "If the amber banner says registers are not published, press Publish them on the register desk.",
        ],
        logic: [
          "Students in them counts seated students only; someone who has left gives their seat back.",
          "Registers to take is the same list as the To mark tab.",
          "Recordings to post counts past live classes, not called off, with no recording.",
          "The banner counts marked registers not yet shown to students. It disappears if the founder has switched the show step off.",
        ],
        controls: [
          {
            setting: "Hide a register until the coach shows it",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Applies at once to every register, past ones included. Off, every mark is visible to students the moment it is taken and the banner goes away.",
          },
        ],
        shot: {
          file: "coaching-summary.png",
          route: "/coaching",
          caption: "My Teaching: your cohorts, students, registers owed and recordings to post.",
          highlight: { text: "Recordings to post", label: "What you owe" },
        },
      },
      {
        id: "this-week",
        name: "This week",
        where: ["Sidebar", "Classroom", "My Teaching", "This week"],
        href: "/coaching",
        what: "Every live class in your cohorts in the next seven days, with the link to start it.",
        use: [
          "Read the classes in date order. A class starting within the hour is outlined and tagged Starting soon.",
          "Press Start the class to open the meeting.",
          "Press Set coursework to give the whole batch a task.",
          "Click the cohort name under a class to open its page.",
        ],
        logic: [
          "Pre-recorded modules are left out; they have no time to start.",
          "Cancelled classes still show so the week reads honestly, but they owe you nothing.",
          "You can act on a class (register, recording, coursework) only in cohorts you lead, unless you are Admin, the head coach or hold the seating permission. Other rows are read-only.",
          "A coach also sees cohorts that hold a student assigned to them, read-only.",
        ],
        shot: {
          file: "coaching-this-week.png",
          route: "/coaching",
          caption: "This week: the classes you run in the next seven days.",
          highlight: { text: "Set coursework", label: "Set work for the batch" },
        },
      },
      {
        id: "to-mark",
        name: "To mark",
        where: ["Sidebar", "Classroom", "My Teaching", "To mark"],
        href: "/coaching?tab=1",
        what: "Every class you have taught but not yet marked, newest first.",
        use: [
          "Press Take the register on a class.",
          "Mark each student and save.",
          "Then show the register to students from the Attendance desk.",
        ],
        logic: [
          "A class lands here once it has ended and has no register at all, in a cohort you are allowed to mark.",
          "Attendance is what the drop-risk signal and every attendance percentage are built on, so an unmarked class makes an absent student look fine.",
          "Marking is private. Students see it, and absence notices start, only once the register is shown.",
        ],
        controls: [
          {
            setting: "Register chase escalates after (hours)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "24 hours",
            effect: "Changes when an unmarked class's reminder turns urgent, for every unmarked class on the next load.",
          },
        ],
        shot: {
          file: "coaching-to-mark.png",
          route: "/coaching?tab=1",
          caption: "To mark: classes you have taught with no register yet.",
          highlight: { text: "Take the register", label: "Mark who came" },
        },
      },
      {
        id: "recording-coursework",
        name: "Post the recording and set coursework",
        where: ["Sidebar", "Classroom", "My Teaching", "This week"],
        href: "/coaching",
        what: "The two jobs on every class card after the register: the recording and the coursework.",
        use: [
          "On a past class, press Post the recording (or Replace the recording).",
          "Paste the Fathom, YouTube, Vimeo or Google Drive link.",
          "Choose Students may watch it for: the house default, 7 to 90 days, or No time limit. Press Post recording.",
          "To set work, press Set coursework, give it a title, a type and an optional due date, and press Set coursework.",
        ],
        logic: [
          "The viewing window counts from when you post. Posting a replacement restarts it and removes the old recording with its watch progress.",
          "Staff always keep access; the window only governs the student portal.",
          "A recording counts as watched at 90% of tracked viewing.",
          "Coursework goes to every student in the batch at once, and is copied to anyone seated later.",
          "Who can post: Admin, the head coach, anyone with the seating permission, and the person who leads the cohort.",
        ],
        controls: [
          {
            setting: "Default viewing window (days)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "0 (no time limit)",
            effect: "Only pre-selects the picker for new recordings. Recordings already posted keep the window they were given.",
          },
        ],
        watchOut: [
          "Replacing a recording deletes the old one and every student's watch progress on it.",
        ],
      },
      {
        id: "cohorts",
        name: "Cohorts",
        where: ["Sidebar", "Classroom", "My Teaching", "Cohorts"],
        href: "/coaching?tab=2",
        what: "One card per active cohort on your desk, with what each still owes.",
        use: [
          "Click a cohort name to open its timetable, material and roster.",
          "Read seats filled against the target, sessions, the plan it runs and the next class.",
          "Look for the amber line naming registers to take or recordings to post.",
        ],
        logic: [
          "Coaching cohorts open their own page; German Note cohorts open the German Note classroom.",
          "A cohort you do not lead says who leads it, or No coach assigned.",
          "If a cohort you run is missing, it has no lead set on it.",
        ],
        controls: [
          {
            setting: "Who leads a cohort",
            where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts"],
            href: "/batches",
            who: ["ADMIN"],
            effect: "The cohort moves onto the new lead's desk on their next page load. Past registers and recordings stay with the cohort.",
          },
        ],
        shot: {
          file: "coaching-cohorts.png",
          route: "/coaching?tab=2",
          caption: "Cohorts: every cohort on your desk and what it still needs.",
          highlight: { text: "Active cohorts", label: "Your cohorts" },
        },
      },
      {
        id: "my-students",
        name: "My students",
        where: ["Sidebar", "Classroom", "My Teaching", "My students"],
        href: "/coaching?tab=3",
        what: "Your own caseload, worst first: attendance, coursework and sprint check-ins.",
        use: [
          "Work the list from the top; that is where the trouble is.",
          "Read Sprint check-in for whose move it is: your verdict, unanswered since a date, or open until a date.",
          "Click a student to open their record.",
        ],
        logic: [
          "It lists active students whose enrolment names you as their coach. Someone who coaches nobody but supervises sees every active enrolment, up to 50.",
          "Order: a red or amber flag set by hand first, then the lowest attendance, then an open sprint check-in, then name. A student with no register yet sorts below anyone with a real figure.",
          "On this list attendance turns amber under 75% and red under 50%.",
          "Three or more weekends in a row with no check-in adds a weekends silent flag.",
        ],
        watchOut: [
          "Recording a sprint verdict on a student's record is open to Admin and the head coach only. A coach account sees the queue but cannot clear it.",
        ],
        shot: {
          file: "coaching-my-students.png",
          route: "/coaching?tab=3",
          caption: "My students, sorted so the student who needs you most is at the top.",
          highlight: { text: "Sprint check-in", label: "Whose move it is" },
        },
      },
      {
        id: "discontinue",
        name: "Discontinue and Recently stopped",
        where: ["Sidebar", "Classroom", "My Teaching", "My students"],
        href: "/coaching?tab=3",
        what: "Taking a student off their programme, and putting them back if it was a mistake.",
        use: [
          "Press Discontinue on the student's row.",
          "Pick a reason, add a note if asked, and press Discontinue.",
          "To undo, find them under Recently stopped and press Put back.",
        ],
        logic: [
          "Discontinuing takes the student off your caseload, the register and the leaderboard. It does not change what they owe.",
          "Recently stopped lists departures from the last 30 days with the reason and who did it. After that, use the Students board.",
          "Put back returns them to the caseload, the register and the leaderboard, and clears the reason.",
          "Admin and the head coach can discontinue anyone; a coach can discontinue their own students while the founder allows it.",
        ],
        controls: [
          {
            setting: "A coach may discontinue their own students",
            where: C_STOP,
            href: consoleHref("system", "student-lifecycle"),
            who: ["ADMIN"],
            default: "On",
            effect: "Applies to the next press. Students already discontinued stay as they are.",
          },
          {
            setting: "Discontinue reasons, and whether a coach may type their own",
            where: C_STOP,
            href: consoleHref("system", "student-lifecycle"),
            who: ["ADMIN"],
            default: "The shipped list, with typing your own reason allowed",
            effect: "Forward only. Students already discontinued keep the reason they were given.",
          },
        ],
      },
    ],
    related: [
      { section: "attendance", why: "The register desk: open check-in, publish registers, chase catch-ups." },
      { section: "batches", why: "Where cohorts are created and their leads assigned." },
      { section: "students", why: "The full student record, sprint verdicts and money." },
      { section: "leaderboard", why: "Your cohort's sprint standings and the self-reported entries to check." },
    ],
    faq: [
      {
        q: "A cohort I teach is not on my desk.",
        a: "It has no lead set, or someone else is set as lead. Ask the founder to set you as the cohort's coach or tutor on Batches & Plans.",
      },
      {
        q: "I can see a class but cannot take its register.",
        a: "You can read cohorts that hold your students, but only the cohort's lead, the head coach, Admin and anyone with the seating permission can mark them.",
      },
      {
        q: "I marked the register. Why do students not see it?",
        a: "Marking is private. Show it to students from the Attendance desk; that is also what sends absence notices.",
      },
      {
        q: "Will students get reminders before class?",
        a: "Only if class reminders are switched on and set to send for real in WhatsApp settings. They ship off, and rehearsing when first switched on.",
      },
    ],
  },

  // ------------------------------- Attendance -------------------------------
  {
    section: "attendance",
    overview:
      "The register desk: open attendance in class and let the room check itself in, correct what is left, then show the register to students. It also lists classes never marked, registers not yet shown, and students who missed a class and have not caught up. It scopes itself to the cohorts you lead; the founder, the head coach and anyone allowed to seat students see every active cohort.",
    engines: ["classReminders", "whatsapp", "cron"],
    features: [
      {
        id: "open-attendance",
        name: "Open attendance",
        where: ["Sidebar", "Classroom", "Attendance"],
        href: "/attendance",
        what: "A self check-in window: for a few minutes, every student in the cohort gets an I'm here button.",
        use: [
          "Find today's class and press Open attendance.",
          "Pick Open for (5 to 60 minutes) and On time for the first (no grace up to 15 minutes), then press Open attendance.",
          "Watch arrivals under Open now; the desk refreshes itself every 10 seconds while a window is open.",
          "Press Close now once the room is complete.",
        ],
        logic: [
          "Only students seated in that cohort see the button, on their dashboard and classroom, with a countdown.",
          "A check-in within the grace records Present; after it, Late, which still counts as attending. Lateness counts from whichever is later: the class start or the moment you opened.",
          "A student cannot check in over a mark you already made.",
          "The button is offered only from a day before to a day after the class. Pre-recorded modules have no register.",
          "Who can open, mark and show a register: Admin, the head coach, anyone with the seating permission, and the person who leads that cohort.",
        ],
        controls: [
          {
            setting: "Let students check themselves in",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Off hides every I'm here button and the Open attendance button at once. Marks already made stay.",
          },
          {
            setting: "Default window length and on-time minutes",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "15 minutes open, on time for the first 10",
            effect: "Only the starting values in the Open attendance box. A window already open keeps what it was opened with.",
          },
        ],
        shot: {
          file: "attendance-open-attendance.png",
          route: "/attendance",
          caption: "The register desk, with what is open right now at the top.",
          highlight: { text: "Open right now", label: "Windows open now" },
        },
      },
      {
        id: "register",
        name: "Take the register",
        where: ["Sidebar", "Classroom", "Attendance", "Today"],
        href: "/attendance",
        what: "The register itself: mark or correct every student, finish the rest in one press, and ask about an absence.",
        use: [
          "Press Take register (or Edit register) on the class.",
          "Set each row; a row the student ticked shows the time they arrived. Press Save attendance.",
          "Press Rest absent to mark everyone without a mark absent. Students who already have a mark are left alone.",
          "On a saved absence, press Ask why. The student's answer comes back on the same row, with Excuse beside it.",
        ],
        logic: [
          "A class cannot be marked more than an hour before it starts.",
          "Clearing a row means the register was not taken for that student, which is different from absent.",
          "Excused takes the class out of that student's attendance percentage. Late counts as attended.",
          "Ask why only works on an absence, once. Asking again never wipes an answer, and no student is ever asked unless you press it.",
          "Today lists every class today in your cohorts, including one that is open right now.",
        ],
        shot: {
          file: "attendance-register.png",
          route: "/attendance",
          caption: "Today's classes, with how many students checked themselves in.",
          highlight: { text: "Checked in today", label: "Self check-ins today" },
        },
      },
      {
        id: "never-marked",
        name: "Never marked",
        where: ["Sidebar", "Classroom", "Attendance", "Never marked"],
        href: "/attendance",
        what: "Past classes with no register at all.",
        use: [
          "Work down the list and press Take register on each.",
          "If a class did not happen, call it off from the cohort's timetable instead.",
        ],
        logic: [
          "Lists live classes from the last six weeks that have ended with no marks, in cohorts you can mark.",
          "An unmarked class makes an absent student look fine, because attendance and the drop-risk signal are built from the register.",
          "A reminder appears as soon as a taught class has no register, and turns urgent after the escalation time.",
        ],
        controls: [
          {
            setting: "Register chase escalates after (hours)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "24 hours",
            effect: "Changes when an unmarked class's reminder turns urgent, for every unmarked class on the next load.",
          },
        ],
        shot: {
          file: "attendance-never-marked.png",
          route: "/attendance",
          caption: "Classes taught with no register taken.",
          highlight: { text: "Never marked", label: "Registers owed" },
        },
      },
      {
        id: "publish",
        name: "Not shown to students",
        where: ["Sidebar", "Classroom", "Attendance", "Not shown to students"],
        href: "/attendance",
        what: "Marked registers the batch cannot see yet, with the press that shows them.",
        use: [
          "Correct the register first: excuse anyone who told you in advance.",
          "Press Show to students.",
          "Press Hide if you need to take it back.",
        ],
        logic: [
          "Marking is private. Showing a register is what makes the marks visible to students, counts them in their attendance and starts absence notices.",
          "An empty register cannot be shown.",
          "In-app absence notices are worked out from shown registers only. WhatsApp absence messages also need their own switch, and cover shown registers from the last 14 days.",
          "A student always sees their own check-in, shown or not.",
          "If the founder switches the show step off, every mark is visible the moment it is made and this list stays empty.",
        ],
        controls: [
          {
            setting: "Hide a register until the coach shows it",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Applies at once to every register, past ones included. Off, every mark is visible to students the moment it is taken.",
          },
          {
            setting: "Tell a student in the app when they are marked absent",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "Notifications are worked out on each load, so this applies straight away to every shown register.",
          },
          {
            setting: "Marked absent (student) WhatsApp message",
            where: WA_SETTINGS,
            href: "/whatsapp?tab=1",
            who: ["ADMIN"],
            default: "Off, and rehearsing until Send for real is ticked",
            effect: "Forward only. Each student gets at most one message per class; switching on can reach shown registers from the last 14 days.",
          },
        ],
        shot: {
          file: "attendance-publish.png",
          route: "/attendance",
          caption: "Registers that are marked but not yet shown to the batch.",
          highlight: { text: "Not shown to students", label: "Waiting to be shown" },
        },
      },
      {
        id: "catch-up",
        name: "Not caught up",
        where: ["Sidebar", "Classroom", "Attendance", "Not caught up"],
        href: "/attendance",
        what: "Students who missed a class and still have not watched its recording, grouped by class.",
        use: [
          "Work the list from the top; it is grouped by class, because one cause usually covers several students.",
          "No recording: press Post the recording.",
          "Window closed: reopen it for 7, 14, 30, 60 or 90 days, or press No limit.",
          "Overdue: contact the student. The percentage shown is tracked viewing.",
        ],
        logic: [
          "Lists students marked absent (not late, not excused) in the last 60 days who have not watched that class's recording.",
          "Overdue starts once the catch-up grace has passed since the recording was posted, not since the class.",
          "Watched means 90% of tracked viewing. A student who ticked it at 40% still shows, labelled disputed.",
          "Scoped to cohorts you can mark.",
          "Once overdue, the student gets an in-app nudge if the founder has it on; a WhatsApp nudge needs its own switch.",
        ],
        controls: [
          {
            setting: "Catch-up grace (hours)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "24 hours",
            effect: "Re-judges every row on the next load, because the state is worked out, never stored.",
          },
          {
            setting: "Nudge them again if the recording goes unwatched",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "On",
            effect: "In-app only, and worked out on each load, so it applies straight away.",
          },
          {
            setting: "Recording not watched (student) WhatsApp message",
            where: WA_SETTINGS,
            href: "/whatsapp?tab=1",
            who: ["ADMIN"],
            default: "Off",
            effect: "Forward only. Sent once per student per class, only while the recording can still be opened.",
          },
        ],
        shot: {
          file: "attendance-catch-up.png",
          route: "/attendance",
          caption: "Students who missed a class and have not watched the recording.",
          highlight: { text: "Not caught up", label: "Catch-up list" },
        },
      },
      {
        id: "cohorts",
        name: "Your cohorts",
        where: ["Sidebar", "Classroom", "Attendance", "Your cohorts"],
        href: "/attendance",
        what: "A standing summary of attendance per cohort, and the registers marked recently.",
        use: [
          "Click a cohort to open its page.",
          "Scroll to Recently marked to reopen a register that is already shown.",
        ],
        logic: [
          "Each card shows the level, roster size, how many of its live classes from six weeks ago onwards (upcoming ones included) are marked, and the rate across all marks.",
          "The rate pill is green from 80%, amber from 60% and red below. These bands are fixed on this card.",
          "A cohort you do not lead says You are supervising this one.",
          "No cohort at all means you are not set as the lead of any active cohort.",
        ],
        shot: {
          file: "attendance-cohorts.png",
          route: "/attendance",
          caption: "Your cohorts, with the attendance rate across every class marked so far.",
          highlight: { text: "Your cohorts", label: "Cohort summary" },
        },
      },
    ],
    related: [
      { section: "coaching", why: "Your week, the registers you owe and the recordings to post." },
      { section: "batches", why: "Cohort timetables, rosters and who leads each cohort." },
      { section: "classroom", why: "What students see: the check-in button, their marks and the recordings." },
      { section: "whatsapp", why: "Class reminders and the absence and catch-up messages are switched on there." },
    ],
    faq: [
      {
        q: "Why can I not press Open attendance?",
        a: "Either self check-in is switched off in the Console, the class is more than a day away or over a day ago, or you do not lead that cohort.",
      },
      {
        q: "A student says they checked in but shows absent.",
        a: "Open the register. A row the student ticked shows the time they arrived. If you saved over it, your mark wins; change it back and save.",
      },
      {
        q: "Does showing a register message the absent students?",
        a: "In the app, yes, if the absence notice is on. By WhatsApp only if that message is switched on and set to send for real.",
      },
      {
        q: "Why does the page warn that class reminders are off?",
        a: "Because no student or coach is being told a class is about to start. The founder switches reminders on in WhatsApp settings.",
      },
    ],
  },

  // ------------------------------- Batches & Plans -------------------------------
  {
    section: "batches",
    overview:
      "Batches & Plans is the setup side of a classroom: create a cohort, write the week-by-week plan it is taught from, build its dated timetable and seat its learners. The founder does all of it; a head coach can come in only if granted the seating permission, and then sees cohorts and rosters without create, edit or Plans.",
    engines: ["studentWelcome", "whatsapp"],
    features: [
      {
        id: "coaching-cohorts",
        name: "Coaching cohorts",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts"],
        href: "/batches",
        what: "Every coaching cohort, with what each one still needs.",
        use: [
          "Press Create batch. Name it, pick the programme, the coach, the start date and a target class size, then press Create batch.",
          "Read each row: its state, what it still needs, the coach, the dates, the classes and the seats taken.",
          "Click a cohort's name to open its timetable, material and roster.",
          "To close a cohort that ran, edit it and set Status to Archived.",
        ],
        logic: [
          "Draft, Ready to start, Running and Completed are worked out from the cohort every time, never stored. Only Active and Archived are saved.",
          "Draft means it lacks a plan, a coach or at least one learner. Missing dates or classes are listed too, but do not block starting.",
          "Completed means every class is in the past. Adding a class makes it run again.",
          "A cohort can only seat programmes from its own business.",
          "Target class size is a warning, not a cap: seating past it asks you to confirm.",
          "Only an empty cohort can be deleted. Archived cohorts keep their roster, classes and recordings, and stop being offered for seating.",
        ],
        controls: [
          {
            setting: "Programmes a cohort can run",
            where: ["Sidebar", "Admin", "Programs"],
            href: "/programs",
            who: ["ADMIN"],
            effect: "A new programme can be picked for new cohorts straight away. Switching a level off keeps every cohort already on it.",
          },
        ],
        watchOut: [
          "The head coach can open this page only with the seating permission, which is off by default. Without it they are turned away.",
        ],
        shot: {
          file: "batches-coaching-cohorts.png",
          route: "/batches",
          caption: "Coaching cohorts, each saying what it still needs.",
          highlight: { text: "Create batch", label: "Make a new cohort" },
        },
      },
      {
        id: "german-note-cohorts",
        name: "German Note cohorts",
        where: ["Sidebar", "Classroom", "Batches & Plans", "German Note cohorts"],
        href: "/batches?tab=1",
        what: "Where German Note cohorts are created; their classes are run from German Note.",
        use: [
          "Press Create batch, pick the German level and the tutor, and save.",
          "Schedule its classes one at a time from the German Note classroom.",
          "Add learners under German Note, Manage, Members.",
        ],
        logic: [
          "German Note cohorts need no plan: they are ready with a tutor and at least one learner.",
          "Rows here do not link to a timetable, because German Note classes are scheduled in its own classroom.",
          "Only German levels can be seated in a German Note cohort.",
        ],
        shot: {
          file: "batches-german-note-cohorts.png",
          route: "/batches?tab=1",
          caption: "German Note cohorts, created here and run from German Note.",
          highlight: { text: "German Note batches", label: "German Note cohorts" },
        },
      },
      {
        id: "plans",
        name: "Plans",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Plans"],
        href: "/batches?tab=2",
        what: "The week-by-week sheets cohorts are built from: week, topic, duration, day and time.",
        use: [
          "Press New curriculum, or Start from the Guided programme on an empty list.",
          "Name it, link the programme, and set the sprint length in days.",
          "Add a session per row: week, topic, type, live or pre-recorded, duration, weekday and start time in India time.",
          "Use Preview a start date to see the dates a cohort would get.",
        ],
        logic: [
          "A plan dates itself per cohort. The first live class falls on the first matching weekday on or after the cohort's start date; each later one on the next matching weekday.",
          "A pre-recorded module is released with the session before it and never moves the live classes.",
          "The sprint starts on the last live class and runs for the plan's sprint length. 0 means no sprint.",
          "Editing a plan never changes a cohort already built from it. Rebuild that cohort's timetable to pick up the change.",
          "Material added to a plan's session reaches every cohort that runs the plan.",
          "This is the same list as Programs, Curriculum. Only Admin can write plans, and the tab is only shown to Admin.",
        ],
        shot: {
          file: "batches-plans.png",
          route: "/batches?tab=2",
          caption: "Plans: the week-by-week sheets every cohort timetable is built from.",
          highlight: { text: "New curriculum", label: "Write a plan" },
        },
      },
      {
        id: "setup",
        name: "Cohort setup",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts", "Cohort setup"],
        what: "The checklist at the top of a cohort's page, and the button that starts it.",
        use: [
          "Open a cohort. Cohort setup lists what is missing, each with a link to fix it.",
          "When a plan, a coach and a learner are in place, press Start cohort.",
        ],
        logic: [
          "Start cohort sets today as the cohort's start date. Only Admin can press it.",
          "It stays disabled, with the reason on it, until a plan, a coach and at least one learner are in place.",
          "The card disappears once the cohort is complete and running.",
        ],
        shot: {
          file: "batches-setup.png",
          route: "/batches/[first]",
          caption: "A cohort's setup checklist, naming what is missing.",
          highlight: { text: "Cohort setup", label: "What this cohort needs" },
        },
      },
      {
        id: "timetable",
        name: "Timetable",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts", "Timetable"],
        what: "The cohort's dated classes, built from a plan and adjusted class by class.",
        use: [
          "Press Build from curriculum, choose the plan and a start date, check the preview and press Build timetable.",
          "Edit a class on its row to re-time it, or press Add a session for an extra class.",
          "To call a class off, choose Cancelled or Postponed, add a reason and press Call it off.",
        ],
        logic: [
          "Rebuilding moves only classes with no register: marked classes keep their dates. Old classes are removed only if they have no marks and no coursework.",
          "A called-off class stays on students' timetables, struck through with your reason, and is left out of attendance percentages and class reminders.",
          "A live class with no time on the plan reads time to be confirmed until you set one.",
          "Who can edit: Admin, the head coach, anyone with the seating permission and the cohort's lead. A coach whose student is in the cohort can only read it.",
        ],
        shot: {
          file: "batches-timetable.png",
          route: "/batches/[first]",
          caption: "A cohort's timetable, built from its plan.",
          highlight: { text: "Add a session", label: "Add or change classes" },
        },
      },
      {
        id: "resources",
        name: "Resources",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts", "Resources"],
        what: "Links for the whole cohort and for single classes, released to students when you choose.",
        use: [
          "Under For the whole cohort, press Add a resource for anything true for every class, such as the WhatsApp group or shared drive.",
          "Under Per class, add material to one class.",
          "Untick Students can see this to stage something and release it after the class.",
        ],
        logic: [
          "Each resource is a link with a type label; nothing is uploaded.",
          "A resource lives in exactly one place: the whole cohort, one class, or a plan session that reaches every cohort running the plan.",
          "Students only ever receive items marked visible; hidden ones never reach their screen.",
          "Cohort and class material can be added by whoever runs the cohort; plan material is the founder's.",
        ],
        shot: {
          file: "batches-resources.png",
          route: "/batches/[first]?tab=1",
          caption: "A cohort's material: the whole-cohort shelf and each class's own links.",
          highlight: { text: "For the whole cohort", label: "Cohort material" },
        },
      },
      {
        id: "roster",
        name: "Roster",
        where: ["Sidebar", "Classroom", "Batches & Plans", "Coaching cohorts", "Roster"],
        what: "Who is seated in the cohort, their attendance, and the button to add more.",
        use: [
          "Press Add learners, tick the people to seat, and confirm. Several at once is fine.",
          "Read each learner's programme, coach, attendance and status.",
        ],
        logic: [
          "Only people enrolled on a matching programme and not already in a cohort can be seated.",
          "Seating copies any coursework already set for the cohort to the new learner and, if the enrolment welcome is on, sends them the welcome message.",
          "Seating needs the seating permission, which only Admin holds by default.",
          "The attendance colour follows the founder's thresholds: amber below 80%, red below 60%, or red after 3 misses in a row. With fewer than 2 counted classes (excused ones are not counted) there is no colour yet.",
        ],
        controls: [
          {
            setting: "Seat students in batches (the seating permission)",
            where: C_PERSON,
            href: consoleHref("access", "per-person"),
            who: ["ADMIN"],
            default: "Admin only",
            effect: "Applies on the person's next page load. It also opens Batches & Plans to a head coach, without create, edit or Plans.",
          },
          {
            setting: "Attendance risk thresholds (amber, red, misses in a row, minimum classes)",
            where: C_ALERTS,
            href: consoleHref("system", "alerts"),
            who: ["ADMIN"],
            default: "Amber below 80%, red below 60%, red after 3 in a row, at least 2 classes",
            effect: "Re-colours every roster on the next load; nothing is stored.",
          },
          {
            setting: "Enrolment welcome",
            where: WA_SETTINGS,
            href: "/whatsapp?tab=1",
            who: ["ADMIN"],
            default: "Off",
            effect: "Forward only: sent when a student is seated. Someone seated while it was off gets it only if they are seated again.",
          },
        ],
        shot: {
          file: "batches-roster.png",
          route: "/batches/[first]?tab=2",
          caption: "A cohort's roster, with attendance per learner.",
          highlight: { text: "Add learners", label: "Seat learners" },
        },
      },
    ],
    related: [
      { section: "coaching", why: "Where whoever leads a cohort runs it week to week." },
      { section: "attendance", why: "Registers for every cohort built here." },
      { section: "programs", why: "Programmes and the same plans, under Curriculum." },
      { section: "students", why: "Enrolments decide who can be seated in a cohort." },
      { section: "german-note", why: "German Note cohorts are scheduled and filled there." },
    ],
    faq: [
      {
        q: "Why does my cohort still say Draft?",
        a: "It is missing a plan, a coach or a learner. Open it; Cohort setup names what is missing and links to the fix.",
      },
      {
        q: "I changed the plan. Why did the cohort's dates not change?",
        a: "A plan never rewrites a cohort already built from it. Open the cohort and press Rebuild from curriculum; classes already marked keep their dates.",
      },
      {
        q: "Why can I not delete a cohort?",
        a: "Only an empty cohort can be deleted. Archive a cohort that ran; its roster, classes and recordings stay readable.",
      },
      {
        q: "Why can the head coach not open this page?",
        a: "They need the seating permission, granted in Founder Console, Access, Per-person rules. Even then, creating and editing stay with Admin.",
      },
    ],
  },

  // ------------------------------- Leaderboard -------------------------------
  {
    section: "leaderboard",
    overview:
      "One board for the four taught weeks and the 90-day (Guided) or 120-day (Elite) sprint. It scores attendance, recordings, coursework, sprint weeks, applications, recruiter connections and interviews together. Students see their own cohort; coaches and the founder see the cohorts they run, with a feed to correct what students log.",
    features: [
      {
        id: "standings",
        name: "Standings",
        where: ["Sidebar", "Classroom", "Leaderboard"],
        href: "/leaderboard",
        what: "Everyone in the cohort ranked by points.",
        use: [
          "Find your row, marked you.",
          "Tap your own row to see how your total was built, metric by metric.",
          "Staff: pick a cohort with the buttons at the top.",
        ],
        logic: [
          "Points are count times points per metric, added up. Defaults: class attended 10, recording watched 5, coursework done 10, sprint week hit 25, application sent 5, application reviewed 15, HR connection 10, HR interview 50, offer received 200, win shared 5.",
          "Counting starts at the sprint start. Until the sprint begins it counts the whole programme from enrolment, and the line under the title says which.",
          "It ranks within your own cohort by default. Equal totals share a place: two on the same score are both second, and the next is fourth.",
          "Students see classmates' totals only, never their breakdown. If names are hidden, classmates show as Student A, B, C by row.",
          "A recording counts only at 90% of tracked viewing; a tick alone does not score.",
          "Only active enrolments are ranked.",
        ],
        controls: [
          {
            setting: "Show the leaderboard",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "On",
            effect: "Off, the page says the board is switched off, for students and staff alike.",
          },
          {
            setting: "Students see (named, anonymised or staff only)",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "Named",
            effect: "Applies on the next load. Names are removed before the page is sent, so a hidden name never reaches a student's browser.",
          },
          {
            setting: "Count from, rank within and show top N",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "Sprint start, their own cohort, whole cohort shown",
            effect: "The board is worked out on every load, so a change re-scores it at once, past weeks included.",
          },
          {
            setting: "Points and weekly limit per metric",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "The catalogue values above; limits only on the logged metrics",
            effect: "Re-scores the whole board on the next load, past weeks included. Nothing is stored.",
          },
        ],
        shot: {
          file: "leaderboard-standings.png",
          route: "/leaderboard",
          caption: "The sprint standings for one cohort.",
          highlight: { text: "Standings", label: "The ranking" },
        },
      },
      {
        id: "benchmark",
        name: "You vs the cohort",
        where: ["Sidebar", "Classroom", "Leaderboard"],
        href: "/leaderboard",
        what: "How your numbers compare with the cohort average, without naming anybody.",
        use: [
          "Read the cohort average and median for each metric, and your own figure beside it.",
          "Check Outreach that turned into interviews for your ratio against the cohort's.",
        ],
        logic: [
          "Averages are worked out over the whole cohort, for the same period as the board, before any names are removed.",
          "Mean and median are both shown, because one student far ahead drags the mean.",
          "Hidden when the cohort is smaller than the floor, because a small average can reveal one classmate. The floor can never go below 3.",
          "Staff see Cohort averages without a personal line.",
        ],
        controls: [
          {
            setting: "Average needs (minimum cohort size)",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "5 students",
            effect: "Applies on the next load. Below it the comparison is replaced by a sentence saying why.",
          },
        ],
        shot: {
          file: "leaderboard-benchmark.png",
          route: "/leaderboard",
          caption: "Your numbers against your cohort's average and median.",
          highlight: { text: "You vs the cohort", label: "Cohort comparison" },
        },
      },
      {
        id: "sprint-log",
        name: "Your sprint log",
        where: ["Sidebar", "Classroom", "Leaderboard"],
        href: "/leaderboard",
        what: "Where you log the few things the app cannot see for itself.",
        use: [
          "Press Log something.",
          "Pick what happened: HR connection accepted, application reviewed by a company, HR interview secured, or something else worth sharing.",
          "Set the day it actually happened, the company and how many, then press Log it.",
          "Withdraw an entry you logged by mistake.",
        ],
        logic: [
          "An entry scores straight away; it does not wait for approval.",
          "The date must be today or earlier, and not before you enrolled.",
          "Each logged metric has a weekly limit (application reviewed 20, HR connection 25, HR interview 10, win 5 by default). Your ceiling is the limit times the weeks so far, so a big quantity cannot buy a big jump.",
          "Your coach can change or remove an entry, and sees that you logged it.",
          "Attendance, recordings, coursework and the applications in your tracker are counted for you; log only what the app cannot see.",
        ],
        controls: [
          {
            setting: "Weekly limit per logged metric",
            where: C_BOARD,
            href: consoleHref("system", "leaderboard"),
            who: ["ADMIN"],
            default: "Application reviewed 20, HR connection 25, HR interview 10, win 5",
            effect: "Set by the admin. Re-scores the board on the next load; entries you logged are kept and simply counted up to the new limit.",
          },
        ],
        shot: {
          file: "leaderboard-sprint-log.png",
          route: "/leaderboard",
          caption: "Your sprint log, for what the app cannot see.",
          highlight: { text: "Log something", label: "Log an achievement" },
        },
      },
      {
        id: "review",
        name: "Self-reported, recently",
        where: ["Sidebar", "Classroom", "Leaderboard"],
        href: "/leaderboard",
        what: "The staff feed of what students logged themselves, for correction.",
        use: [
          "Read each entry: student, what, when, company and quantity.",
          "Press Edit to change the quantity, or Remove to take the entry off.",
        ],
        logic: [
          "Entries scored the moment they were logged. This feed corrects; it does not approve.",
          "Removing an entry removes its points at once.",
          "Who can correct: Admin, the head coach, anyone with the seating permission, and the cohort's lead.",
          "Staff pick from the cohorts they run; Admin and the head coach can pick any active coaching cohort.",
        ],
        shot: {
          file: "leaderboard-review.png",
          route: "/leaderboard",
          caption: "The feed of self-reported entries, with Edit and Remove on each.",
          highlight: { text: "Self-reported, recently", label: "Entries to check" },
        },
      },
    ],
    related: [
      { section: "classroom", why: "Attendance, recordings and coursework there all score here." },
      { section: "my-journey", why: "Sprint weeks marked achieved score here." },
      { section: "coaching", why: "Coaches pick their cohort's board and correct logged entries." },
    ],
    faq: [
      {
        q: "Why did my place change when I did nothing?",
        a: "Your classmates scored, a register was marked, or your coach corrected an entry. The board is worked out fresh every time you open it.",
      },
      {
        q: "I logged 30 connections but only some counted.",
        a: "Each logged metric has a weekly limit. The rest counts as more weeks of the sprint pass.",
      },
      {
        q: "Can I see how a classmate got their score?",
        a: "No. Their total is on the board; the breakdown behind it is theirs.",
      },
      {
        q: "Why are the names hidden?",
        a: "The admin has chosen to anonymise the board. You still see your own name and your own breakdown.",
      },
    ],
  },

  // ------------------------------- App Guide -------------------------------
  {
    section: "guide",
    overview:
      "The App Guide explains every screen you can open: how to use each part, the logic behind it, and where that logic is changed. It also has start-to-finish walkthroughs for jobs that cross several screens. It only ever shows what your account can reach.",
    features: [
      {
        id: "index",
        name: "Guide index",
        where: ["Sidebar", "My Work", "App Guide"],
        href: "/guide",
        what: "One card per section you can open, grouped like your sidebar, with one search across every manual.",
        use: [
          "Type in the search box to find a screen, a tab or a setting by name.",
          "Click a section to open its full manual.",
          "Founders: press Rules map at the top to see every changeable rule in one place.",
        ],
        logic: [
          "Only sections your account can open are listed, so nothing here describes a screen you cannot reach.",
          "The search reads every manual's text, steps, logic and setting names.",
          "Things that are not one screen, such as notifications, sit under Everywhere in the app.",
        ],
        controls: [
          {
            setting: "Which roles see each section",
            where: C_SECTIONS,
            href: consoleHref("access", "sections"),
            who: ["ADMIN"],
            effect: "The guide follows the sidebar: a section switched on or off changes both on the person's next page load.",
          },
        ],
        shot: {
          file: "guide-index.png",
          route: "/guide",
          caption: "The App Guide index, grouped the same way as the sidebar.",
        },
      },
      {
        id: "walkthroughs",
        name: "Start to finish",
        where: ["Sidebar", "My Work", "App Guide"],
        href: "/guide",
        what: "Walkthroughs of jobs that cross several screens, each step naming where to go first.",
        use: [
          "Scroll below the index to Start to finish.",
          "Follow the steps in order; each starts with a breadcrumb to the screen.",
          "Read the one for your job first, for example Run a week of classes or Onboard a new student.",
        ],
        logic: [
          "Walkthroughs are chosen by your role, not by section, because they cross sections. You may read a step that happens on a screen you cannot open, so you know where your part ends.",
          "Run a week of classes is for Admin, the head coach, coaches and tutors. Onboarding and a telecaller's first morning are for Admin, the head coach and telecallers. Starting a cohort, taking a payment and switching the app on are for Admin.",
          "Students have no walkthroughs; their pages have manuals instead.",
        ],
        shot: {
          file: "guide-walkthroughs.png",
          route: "/guide",
          caption: "Start-to-finish walkthroughs, filtered to your role.",
          highlight: { text: "Start to finish", label: "Walkthroughs" },
        },
      },
      {
        id: "manual",
        name: "Section manual",
        where: ["Sidebar", "My Work", "App Guide", "A section"],
        what: "The full manual for one screen: every tab, how to use it, the logic, and where to change it.",
        use: [
          "Open a section from the index.",
          "Read In thirty seconds for the short version.",
          "Jump to a part of the screen from On this page.",
          "Under Change or reset this rule, press Open the setting to go straight to it.",
          "Press Open at the top to go to the screen itself.",
        ],
        logic: [
          "You can read a manual only for a section you can open.",
          "Automations behind this screen shows each related automation's live On or Off state, with what is not happening while it is off. Students never see this block.",
          "Each Change or reset this rule card shows the default, who can change it, what a change does to records that already exist, and how to reset it.",
          "A link to a setting is only offered when you can open the screen it points to.",
        ],
        shot: {
          file: "guide-manual.png",
          route: "/guide/attendance",
          caption: "A section manual, with the rules behind each part and where to change them.",
          highlight: { text: "Change or reset this rule", label: "Where to change it" },
        },
      },
      {
        id: "rules-map",
        name: "Rules map",
        where: ["Sidebar", "My Work", "App Guide", "Rules map"],
        what: "Every rule you can change, on one page, grouped by where you change it. Founders only.",
        use: [
          "Press Rules map at the top of the App Guide.",
          "Filter by a word such as commission, cutoff or WhatsApp.",
          "Read Used by on a rule to see every screen that follows it before you change it.",
        ],
        logic: [
          "Built from the manuals themselves, so it can never list a setting the manuals do not.",
          "Two manuals pointing at the same setting show as one rule with both screens under it.",
          "Admin only: nearly every rule lives in the Founder Console, which no other role can open.",
        ],
        shot: {
          file: "guide-rules-map.png",
          route: "/guide/rules",
          caption: "The rules map: every changeable rule and every screen it moves.",
          highlight: { text: "Rules map", label: "All the rules" },
        },
      },
    ],
    related: [
      { section: "console", why: "Almost every rule the manuals point at is changed there." },
    ],
    faq: [
      {
        q: "A screen I use has no manual.",
        a: "Every section has one. If you cannot find it, your account may not have that section; check the sidebar.",
      },
      {
        q: "A setting link does nothing for me.",
        a: "The link only shows when you can open the screen it points to. Most rules are the founder's to change.",
      },
      {
        q: "Who sees the Automations block?",
        a: "Everyone except students. It reads the same live list as Founder Console, System, Not armed.",
      },
    ],
  },
];
