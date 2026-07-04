/**
 * DEV-ONLY sample data for Phase 1 review.
 * Purge with: npm run db:sample -- --purge
 * Rows are identified for purge by the fixed sample identities below (names,
 * vendors, phone prefix) — dev DB only, so name collisions are not a concern.
 * Expected dashboard numbers are printed at the end for cross-checking the UI.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const FX = new Prisma.Decimal("108.7435");

const SAMPLE_STUDENTS = ["Ravi Kumar", "Priya Sharma", "Anna Schmidt", "Arjun Mehta"];
const SAMPLE_VENDORS = ["Meta Ads", "Karthick", "Skool", "WATI"];
const SAMPLE_PHONE_PREFIX = "+91 98111 22"; // all Phase 1 sample leads share this prefix

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const inr = (major: number) => BigInt(Math.round(major * 100));

async function purge() {
  // Leads cascade stage history and discovery outcomes
  await prisma.lead.deleteMany({ where: { phone: { startsWith: SAMPLE_PHONE_PREFIX } } });
  await prisma.income.deleteMany({ where: { studentName: { in: SAMPLE_STUDENTS } } });
  await prisma.expense.deleteMany({
    where: { vendor: { in: SAMPLE_VENDORS }, date: { gte: d("2026-07-01"), lte: d("2026-07-02") } },
  });
  await prisma.pendingPayment.deleteMany({ where: { studentName: { in: SAMPLE_STUDENTS } } });
  console.log("Sample data purged.");
}

async function main() {
  if (process.argv.includes("--purge")) return purge();

  const users = await prisma.user.findMany();
  const byName = (n: string) => users.find((u) => u.name === n)?.id ?? null;
  const ameen = byName("Ameen");
  const asma = byName("Asma");
  const nilofer = byName("Nilofer");

  // ── Income (July + one June for YTD contrast) ──
  await prisma.income.createMany({
    data: [
      { date: d("2026-07-01"), studentName: "Ravi Kumar", amountInrMinor: inr(75000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "GUIDED", paymentType: "INSTALMENT", paymentMethod: "UPI", notes: "1st of 2 instalments — ₹75,000 of ₹1,50,000", enteredById: ameen },
      { date: d("2026-07-02"), studentName: "Priya Sharma", amountInrMinor: inr(120000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "ELITE", paymentType: "FULL_PAYMENT", paymentMethod: "RAZORPAY", notes: "Paid in full on the SSS call", enteredById: ameen },
      { date: d("2026-07-02"), studentName: "Anna Schmidt", amountInrMinor: BigInt(0), amountEurMinor: BigInt(50000), fxRateUsed: FX, programLevel: "GUIDED", paymentType: "INSTALMENT", paymentMethod: "PAYPAL", notes: "€500 via PayPal — Germany-based student", enteredById: ameen },
      { date: d("2026-06-15"), studentName: "Arjun Mehta", amountInrMinor: inr(25000), amountEurMinor: BigInt(0), fxRateUsed: FX, programLevel: "SOLO", paymentType: "FULL_PAYMENT", paymentMethod: "UPI", notes: "Solo plan, paid upfront — June enrolment", enteredById: ameen },
    ],
  });

  // ── Expenses (July) ──
  await prisma.expense.createMany({
    data: [
      { date: d("2026-07-01"), amountInrMinor: inr(40000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "MARKETING", isCogs: false, vendor: "Meta Ads", notes: "July lead-gen campaign budget", enteredById: ameen },
      { date: d("2026-07-01"), amountInrMinor: inr(50000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "TEAM_SALARIES", isCogs: true, vendor: "Karthick", notes: "Delivery coach salary — July", enteredById: ameen },
      { date: d("2026-07-02"), amountInrMinor: inr(4000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "TOOLS_SOFTWARE", isCogs: true, vendor: "Skool", notes: "Student community platform — monthly", enteredById: ameen },
      { date: d("2026-07-02"), amountInrMinor: inr(8000), amountEurMinor: BigInt(0), fxRateUsed: FX, category: "TOOLS_SOFTWARE", isCogs: false, vendor: "WATI", notes: "WhatsApp automation — monthly", enteredById: ameen },
    ],
  });

  // ── Pending payments ──
  await prisma.pendingPayment.createMany({
    data: [
      { studentName: "Ravi Kumar", programLevel: "GUIDED", totalFeeInrMinor: inr(150000), totalFeeEurMinor: BigInt(0), fxRateUsed: FX, nextDueDate: d("2026-06-28"), status: "ACTIVE", notes: "2nd instalment ₹75,000 — overdue since 28 Jun, follow up" },
      { studentName: "Anna Schmidt", programLevel: "GUIDED", totalFeeInrMinor: BigInt(0), totalFeeEurMinor: BigInt(150000), fxRateUsed: FX, nextDueDate: d("2026-07-20"), status: "ACTIVE", notes: "€1,000 balance — 2nd instalment due 20 Jul" },
    ],
  });

  // ── Leads with stage history (booked/completed/won counts come from history) ──
  type Stage = "NEW_LEAD" | "DISCO_BOOKED" | "DISCO_NOT_BOOKED" | "DISCO_COMPLETED" | "SSS_BOOKED" | "SSS_COMPLETED" | "PROPOSAL_SENT" | "WON" | "LOST" | "NO_SHOW";
  const leads: Array<{ name: string; phone: string; src: "INSTAGRAM" | "YOUTUBE" | "REFERRAL" | "WHATSAPP" | "SUMMIT"; dateIn: string; path: Stage[]; wonLevel?: "GUIDED" | "ELITE"; note: string }> = [
    { name: "Ravi Kumar", phone: "+91 98111 22001", src: "INSTAGRAM", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_COMPLETED", "WON"], wonLevel: "GUIDED", note: "DM'd after the salary-negotiation reel" },
    { name: "Priya Sharma", phone: "+91 98111 22002", src: "YOUTUBE", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_COMPLETED", "WON"], wonLevel: "ELITE", note: "Booked from YouTube video CTA — very responsive" },
    { name: "Deepak Nair", phone: "+91 98111 22003", src: "INSTAGRAM", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED"], note: "Asked about EMI options in DM" },
    { name: "Sneha Reddy", phone: "+91 98111 22004", src: "REFERRAL", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_COMPLETED"], note: "Referred by a past Guided student" },
    { name: "Vikram Singh", phone: "+91 98111 22005", src: "WHATSAPP", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "NO_SHOW"], note: "No-show — reschedule message sent" },
    { name: "Amit Patel", phone: "+91 98111 22006", src: "SUMMIT", dateIn: "2026-07-02", path: ["NEW_LEAD"], note: "From summit registration list — not contacted yet" },
    { name: "Kiran Rao", phone: "+91 98111 22007", src: "INSTAGRAM", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_COMPLETED", "PROPOSAL_SENT"], note: "Comparing with another program — proposal sent" },
    { name: "Rahul Verma", phone: "+91 98111 22008", src: "YOUTUBE", dateIn: "2026-07-01", path: ["NEW_LEAD", "DISCO_BOOKED", "DISCO_COMPLETED", "SSS_BOOKED"], note: "Keen after discovery — SSS booked" },
  ];

  const leadIds = new Map<string, string>();
  for (const l of leads) {
    const lead = await prisma.lead.create({
      data: {
        name: l.name, phone: l.phone, leadSource: l.src, dateIn: d(l.dateIn),
        stage: l.path[l.path.length - 1], wonLevel: l.wonLevel ?? null,
        notes: l.note, enteredById: nilofer,
        stageHistory: {
          create: l.path.map((s, i) => ({
            fromStage: i === 0 ? null : l.path[i - 1],
            toStage: s,
            changedById: nilofer,
          })),
        },
      },
    });
    leadIds.set(l.name, lead.id);
  }

  // ── Discovery outcomes (Asma) — 5 completed calls, 3 highly qualified ──
  const oc = (name: string, outcome: "QUALIFIED_FOR_SSS" | "FOLLOW_UP_NEEDED", hq: boolean, note: string, sss?: string) => ({
    leadId: leadIds.get(name)!,
    callDate: d("2026-07-02"),
    outcome,
    highlyQualified: hq,
    sssDate: sss ? d(sss) : null,
    notes: note,
    enteredById: asma,
  });
  await prisma.discoveryOutcome.createMany({
    data: [
      oc("Ravi Kumar", "QUALIFIED_FOR_SSS", true, "Strong fit for Guided — budget confirmed, wants to start this month", "2026-07-05"),
      oc("Priya Sharma", "QUALIFIED_FOR_SSS", true, "Decision maker, clear goals — close on the SSS call", "2026-07-04"),
      oc("Sneha Reddy", "FOLLOW_UP_NEEDED", false, "Needs to discuss with family — follow up Friday"),
      oc("Kiran Rao", "QUALIFIED_FOR_SSS", false, "Qualified but budget-sensitive — emphasise instalment option"),
      oc("Rahul Verma", "QUALIFIED_FOR_SSS", true, "Very motivated, laid off last month — urgency is high", "2026-07-06"),
    ],
  });

  console.log(`Sample data created.
EXPECTED (July 2026, FX ${FX}):
  Finance  — revenue ₹2,49,371.75 · expenses ₹1,02,000 · COGS ₹54,000
             gross ₹1,95,371.75 · net ₹1,47,371.75 · margin ≈59.1%
             receivables ₹1,83,743.50 (Ravi ₹75,000 + Anna €1,000→₹1,08,743.50)
             YTD ₹2,74,371.75 · Ravi row RED (overdue)
  Pipeline — leads wk 8 / mo 8 · booked 7 · completed 5
             show-up 71.4% · close 40% · no-show 14.3% · HQ 60%
             conversions Solo 0 · Guided 1 · Elite 1
             target bar 31.2% of ₹8,00,000 → RED`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
