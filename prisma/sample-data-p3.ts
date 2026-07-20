/**
 * DEV-ONLY Phase 3 sample data — snapshots, cash positions, payables, back-months
 * of income/expense for burn & growth, GB-sourced leads.
 * Purge: npx tsx prisma/sample-data-p3.ts --purge
 * Rows are identified for purge by the fixed sample identities below (batch names,
 * ops vendors, phone prefix, week dates) — dev DB only.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const FX = new Prisma.Decimal("108.7435");
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const inr = (major: number) => BigInt(Math.round(major * 100));

const SAMPLE_BATCHES = ["April Batch", "May Batch", "June Batch"];
const SAMPLE_OPS_VENDORS = ["April ops", "May ops", "June ops"];
const SAMPLE_PHONE_PREFIX = "+91 98111 33"; // Phase 3 GB sample leads share this prefix

// Weekly funnel snapshots: Apr → current week (Thursday-rule months)
const WEEKS: Array<[string, number, number, number, number, number, number, number, number, number]> = [
  // weekStart, awareness, leads, calls, proposals, S, G, E, gbDownloads, workshop
  ["2026-04-06", 8000, 6, 3, 1, 0, 0, 0, 8, 0],
  ["2026-04-13", 9500, 7, 4, 2, 0, 1, 0, 10, 0],
  ["2026-04-20", 8800, 6, 3, 1, 1, 0, 0, 9, 40],
  ["2026-04-27", 10200, 8, 5, 2, 0, 1, 0, 12, 0],
  ["2026-05-04", 11000, 8, 5, 2, 0, 1, 0, 12, 0],
  ["2026-05-11", 9800, 7, 4, 1, 0, 0, 1, 11, 0],
  ["2026-05-18", 12500, 9, 6, 3, 1, 1, 0, 15, 60],
  ["2026-05-25", 10800, 8, 5, 2, 0, 1, 0, 13, 0],
  ["2026-06-01", 11500, 9, 5, 2, 0, 1, 0, 14, 0],
  ["2026-06-08", 12800, 10, 6, 3, 0, 1, 1, 16, 0],
  ["2026-06-15", 13500, 11, 7, 3, 1, 1, 0, 17, 80],
  ["2026-06-22", 12200, 10, 6, 2, 0, 1, 0, 15, 0],
  // current week (Mon 29/06, Thu 02/07 → July): matches live pipeline data
  ["2026-06-29", 12000, 10, 7, 1, 0, 2, 0, 25, 0],
];

// Cash positions: 12 Mondays, gently declining then recovering
const MONDAYS = ["2026-04-13", "2026-04-20", "2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25", "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"];
const BALANCES = [520000, 510000, 498000, 505000, 490000, 478000, 470000, 462000, 455000, 448000, 452000, 450000];

async function purge() {
  await prisma.weeklyFunnelSnapshot.deleteMany({ where: { weekStart: { in: WEEKS.map((w) => d(w[0])) } } });
  await prisma.cashPosition.deleteMany({ where: { date: { in: MONDAYS.map((m) => d(m)) } } });
  await prisma.payable.deleteMany({}); // payables have no notes column — sample DB only
  await prisma.lead.deleteMany({ where: { phone: { startsWith: SAMPLE_PHONE_PREFIX } } });
  await prisma.income.deleteMany({ where: { studentName: { in: SAMPLE_BATCHES } } });
  await prisma.expense.deleteMany({ where: { vendor: { in: SAMPLE_OPS_VENDORS } } });
  console.log("Phase 3 sample data purged.");
}

async function main() {
  if (process.argv.includes("--purge")) return purge();
  const users = await prisma.user.findMany();
  const uid = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ameen = uid("Ameen");
  const nilofer = uid("Nilofer");

  // ── Back-months income (growth series) + expenses (burn = avg Apr..Jun) ──
  await prisma.income.createMany({
    data: [
      { date: d("2026-04-20"), studentName: "April Batch", amountInrMinor: inr(150000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "GUIDED", paymentType: "FULL_PAYMENT", paymentMethod: "UPI", notes: "April cohort — collected in full", enteredById: ameen },
      { date: d("2026-05-18"), studentName: "May Batch", amountInrMinor: inr(180000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "GUIDED", paymentType: "FULL_PAYMENT", paymentMethod: "RAZORPAY", notes: "May cohort — collected in full", enteredById: ameen },
      { date: d("2026-06-10"), studentName: "June Batch", amountInrMinor: inr(210000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "ELITE", paymentType: "FULL_PAYMENT", paymentMethod: "RAZORPAY", notes: "June cohort — collected in full", enteredById: ameen },
    ],
  });
  await prisma.expense.createMany({
    data: [
      { date: d("2026-04-15"), amountInrMinor: inr(90000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "OPERATIONS", isCogs: false, vendor: "April ops", notes: "April operating costs — rent, utilities, misc", enteredById: ameen },
      { date: d("2026-05-15"), amountInrMinor: inr(100000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "OPERATIONS", isCogs: false, vendor: "May ops", notes: "May operating costs — rent, utilities, misc", enteredById: ameen },
      { date: d("2026-06-15"), amountInrMinor: inr(110000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "OPERATIONS", isCogs: false, vendor: "June ops", notes: "June operating costs — rent, utilities, misc", enteredById: ameen },
    ],
  });

  // ── GB-sourced leads with completed calls (feeds GB→call rate) ──
  const gbLeads = [
    { name: "Sameer Joshi", phone: "+91 98111 33001", note: "Downloaded Ghosted Blueprint, booked call same day" },
    { name: "Lakshmi Iyer", phone: "+91 98111 33002", note: "Ghosted Blueprint reader — came in via email nurture" },
  ];
  for (const gb of gbLeads) {
    await prisma.lead.create({
      data: {
        name: gb.name, phone: gb.phone, leadSource: "GHOSTED_BLUEPRINT", dateIn: d("2026-07-01"),
        stage: "DISCO_COMPLETED", notes: gb.note, enteredById: nilofer,
        stageHistory: {
          create: [
            { fromStage: null, toStage: "NEW_LEAD", changedById: nilofer },
            { fromStage: "NEW_LEAD", toStage: "DISCO_BOOKED", changedById: nilofer },
            { fromStage: "DISCO_BOOKED", toStage: "DISCO_COMPLETED", changedById: nilofer },
          ],
        },
      },
    });
  }

  // ── Weekly funnel snapshots ──
  for (const [ws, aw, le, ca, pr, s, g, e, gb, wk] of WEEKS) {
    await prisma.weeklyFunnelSnapshot.upsert({
      where: { weekStart: d(ws) },
      update: {},
      create: {
        weekStart: d(ws), awarenessReach: aw, leadsCaptured: le, callsCompleted: ca,
        proposalsSent: pr, enrollmentsSolo: s, enrollmentsGuided: g, enrollmentsElite: e,
        ghostedDownloads: gb, workshopAttendees: wk, notes: "Logged in Monday weekly review",
      },
    });
  }

  // ── Cash positions ──
  for (let i = 0; i < MONDAYS.length; i++) {
    await prisma.cashPosition.upsert({
      where: { date: d(MONDAYS[i]) },
      update: {},
      create: {
        date: d(MONDAYS[i]),
        bankBalanceInrMinor: inr(BALANCES[i]),
        personalSavingsInrMinor: inr(300000),
        notes: "Monday morning balance check",
      },
    });
  }

  // ── Payables (fixed costs → break-even) ──
  await prisma.payable.createMany({
    data: [
      { name: "Karthick salary", category: "TEAM_SALARIES", amountInrMinor: inr(50000), frequency: "MONTHLY", nextDueDate: d("2026-08-01"), isCogs: true, status: "ACTIVE" },
      { name: "Meta Ads budget", category: "MARKETING", amountInrMinor: inr(40000), frequency: "MONTHLY", nextDueDate: d("2026-07-10"), isCogs: false, status: "ACTIVE" },
      { name: "WATI subscription", category: "TOOLS_SOFTWARE", amountInrMinor: inr(8000), frequency: "MONTHLY", nextDueDate: d("2026-07-05"), isCogs: false, status: "ACTIVE" },
      { name: "Skool subscription", category: "TOOLS_SOFTWARE", amountInrMinor: inr(4000), frequency: "MONTHLY", nextDueDate: d("2026-07-15"), isCogs: false, status: "ACTIVE" },
      { name: "Zoom annual plan", category: "TOOLS_SOFTWARE", amountInrMinor: inr(24000), frequency: "ANNUAL", nextDueDate: d("2026-11-01"), isCogs: false, status: "ACTIVE" },
    ],
  });

  console.log(`Phase 3 sample data created.
EXPECTED:
  Runway  — burn = (90k+100k+110k)/3 = ₹1,00,000/mo · cash ₹4,50,000 → runway 4.5 mo AMBER
            break-even = 50k+40k+8k+4k+2k(Zoom/12) = ₹1,04,000
            revenue vs break-even (July ₹2,49,371.75) = +₹1,45,372
            payables due this month = 40k+8k+4k = ₹52,000
  Funnel  — July: 12,000 → 10 → 7 → 1 → 2 (biggest drop Awareness→Lead ≈99.9%)
            overall conversion 20% · Guided share 100% · rev/lead ≈ ₹24,937
            GB: 177 downloads all time · 25 this month · →call 2/177=1.1% · →enrol 1/177=0.6%
            GB revenue attributed = Priya ₹1,20,000
  Top bar — "Runway: 4.5 months" amber badge on every screen (Admin only)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
