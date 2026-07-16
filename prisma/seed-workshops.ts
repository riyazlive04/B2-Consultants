/**
 * Seed the two real German Note workshops (March 2026 & May 2026), reconstructed
 * from the founders' workshop workbooks (03_26 / 05_26).
 *
 * Money is stored as INR paise. Per-conversion book/tutor costs use the sheet's
 * standard per-level rates (books ₹1,300/level; tutor A1 ₹7,000, A2 ₹8,000,
 * B1 ₹12,000) — the founder can fine-tune any row in the app. Ad spend is
 * allocated evenly across the ad-driven (page-2) conversions, exactly as the
 * workbook does; page-3 (organic / referral / carry-over) rows carry no ad cost.
 *
 * Idempotent: re-running replaces both workshops. Run with:  npm run db:workshops
 */

import { PrismaClient, Prisma, type GnWorkshopProduct, type GnWorkshopDayType } from "@prisma/client";

const prisma = new PrismaClient();

const R = (rupees: number) => BigInt(Math.round(rupees * 100)); // → paise
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

// The seed carries only genuine INPUTS. Delivery costs are derived from the level
// cost model and ad spend is allocated at read time — see lib/gn-workshop-pricing
// and server/german-note-workshops. Nothing computed is stored here.

type Slot = [batch: string, time: string];
type Spec = {
  name: string;
  email?: string;
  phone?: string;
  product: GnWorkshopProduct;
  day?: GnWorkshopDayType; // default WEEKDAY
  a1?: Slot;
  a2?: Slot;
  b1?: Slot;
  final: number;
  paid: number;
  method?: string;
  status?: "ON_HOLD";
  free?: boolean;
  ad?: boolean; // ad-driven (page 2) → gets an ad-spend allocation
  due?: string; // ISO
  notes?: string;
};

// ── March 2026 ─────────────────────────────────────────────────
// Page 2 — ad-driven workshop conversions.
const MARCH_ADS: Spec[] = [
  { name: "Vignesh Kumar", email: "vigneshkumar241@gmail.com", product: "A1_A2", day: "WEEKEND", a1: ["B21", "7:00 AM"], a2: ["B20", "10:00 AM"], final: 31999, paid: 31999, method: "UPI", ad: true },
  { name: "Rajesh", email: "krishrajesh257@gmail.com", product: "A1", day: "WEEKEND", a1: ["B21", "7:00 AM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Nandha Kumar", product: "A1", a1: ["B23", "7:00 AM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Ajaikumar", email: "ajai55253@gmail.com", product: "A1_A2", a1: ["B24", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 32299, paid: 32299, method: "UPI", ad: true },
  { name: "Ramnath", email: "ramnathauto@gmail.com", product: "A1_A2_B1", a1: ["B23", "7:00 AM"], a2: ["B19", "8:30 PM"], final: 53599, paid: 44716, method: "UPI · 6 EMI", due: "2026-08-04", ad: true, notes: "6 EMI plan" },
  { name: "Derik", email: "derikrajan94@gmail.com", product: "A2_B1", day: "WEEKEND", a2: ["B16", "10:00 AM"], final: 20999, paid: 20999, method: "UPI", ad: true },
  { name: "Govindarajan (Romarajan)", email: "govindarajanmuth@gmail.com", product: "A2_B1", a2: ["B17", "8:30 PM"], final: 19999, paid: 19999, method: "UPI", ad: true, notes: "39299 was the original quoted price" },
  { name: "Nishanth", email: "nishanthnishk2020@gmail.com", product: "A2", a2: ["B17", "8:30 PM"], final: 18999, paid: 18999, method: "UPI", ad: true },
  { name: "Jitendra", email: "jitendra31072004@gmail.com", product: "A1", day: "WEEKEND", a1: ["B22", "6:00 PM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Bernstein Ilangkathir", email: "bernsteinilangkathir@gmail.com", product: "A1_A2", day: "WEEKEND", a1: ["B22", "6:00 PM"], a2: ["B18", "9:00 AM"], final: 31999, paid: 31999, method: "UPI · 2 EMI", ad: true },
  { name: "Ramesh Kumar", email: "raam.srk@gmail.com", product: "A1", a1: ["B24", "7:00 PM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Manikandan Sri", email: "manikandansri01@gmail.com", product: "A1", a1: ["B28", "7:00 PM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Gokul Ragu", email: "rgokul.ragu10@gmail.com", product: "A1_A2", a1: ["B24", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 31999, paid: 31999, method: "UPI", ad: true },
  { name: "Pragathi Kumar", email: "pragathi9982@gmail.com", product: "A1_A2_B1", a1: ["B25", "8:00 AM"], final: 53599, paid: 18333, method: "UPI · 3 EMI", status: "ON_HOLD", due: "2026-05-11", ad: true, notes: "On hold" },
  { name: "Mailraj Palaniappan (Henry)", email: "mailrajpalaniappan@gmail.com", product: "A1", day: "WEEKEND", a1: ["B21", "7:00 AM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Jeff Jarrett", email: "jeffjarrett18@gmail.com", phone: "8056645126", product: "A1_A2", a1: ["B24", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 31999, paid: 31999, method: "UPI", ad: true },
  { name: "Anand Vijay", email: "vijay.vg@gmail.com", phone: "9994516340", product: "B1", b1: ["B08", "9:30 PM"], final: 22999, paid: 22999, method: "UPI", ad: true },
  { name: "Kameshwaran", email: "rkameshwaran.r@gmail.com", product: "A1", a1: ["B23", "7:00 AM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Balamurali S", email: "balamurali1393@gmail.com", product: "A1", a1: ["B24", "7:00 PM"], final: 16999, paid: 16999, method: "UPI", ad: true },
  { name: "Akshitaa Vijayakumar", email: "akshitaavijayakumar@gmail.com", product: "A1", a1: ["B24", "7:00 PM"], final: 16999, paid: 16999, method: "UPI", ad: true },
];
// Page 3 — organic / referral / carry-over conversions (no ad cost).
const MARCH_ORGANIC: Spec[] = [
  { name: "Manish Sam", email: "manish.sam02@gmail.com", phone: "7402026507", product: "A1_A2", day: "WEEKEND", a1: ["B21", "7:00 AM"], a2: ["B19", "8:30 PM"], final: 0, paid: 0, free: true, notes: "B2 Client — free seat" },
  { name: "Haribabu A", email: "harithaman26@gmail.com", phone: "9360317891", product: "A1_A2", a1: ["B23", "7:00 AM"], final: 30999, paid: 13997, method: "UPI", notes: "From Oct batch" },
  { name: "Arvind Raj", email: "arvindraj.0905@gmail.com", phone: "9739275610", product: "A2_B1", a2: ["Crash Course", "6:00 PM"], b1: ["B07", "6:00 PM"], final: 43035, paid: 43035, method: "German Bank", notes: "B1 normal batch from March" },
  { name: "Abhinaya", email: "abhinayaa316@gmail.com", phone: "9841731897", product: "A1", a1: ["B24", "7:00 PM"], final: 16149, paid: 16149, method: "UPI" },
  { name: "Sony Balajisingh", email: "sonybalajisingh3@gmail.com", phone: "9789907035", product: "A1_A2", day: "WEEKEND", a1: ["B21", "7:00 AM"], a2: ["B20", "10:00 AM"], final: 30598, paid: 30598, method: "UPI" },
  { name: "Kruthiga Santhanam", email: "riyalaster@gmail.com", phone: "7339133100", product: "A1_A2_B1", day: "WEEKEND", a1: ["B22", "6:00 PM"], a2: ["B20", "10:00 AM"], final: 49999, paid: 49999, method: "UPI" },
  { name: "Aadarsh RN", email: "aadhu97@gmail.com", phone: "8122031001", product: "A1_A2", a1: ["B23", "7:00 AM"], a2: ["B20", "10:00 AM"], final: 30598, paid: 30598, method: "UPI" },
  { name: "Naveenraj P", email: "naveenrajp1995@gmail.com", phone: "8124702599", product: "A1", a1: ["B23", "7:00 AM"], final: 0, paid: 0, free: true, notes: "B2 Client — free seat" },
  { name: "Dhashna Moorthy D", email: "dhashnamoorthy98@gmail.com", phone: "8870624406", product: "A1_A2_B1", a1: ["B23", "7:00 AM"], a2: ["B20", "10:00 AM"], final: 48968, paid: 48968, method: "UPI" },
  { name: "Arul Dinesh", email: "adaruldhinesh346@gmail.com", phone: "9659897789", product: "A2", a2: ["B17", "8:30 PM"], final: 17099, paid: 17099, method: "UPI" },
  { name: "Sowmya Kumaresan", email: "sowmya.k19@gmail.com", phone: "9487310554", product: "B1", day: "WEEKEND", b1: ["B09", "8:00 PM"], final: 21000, paid: 21000, method: "UPI" },
  { name: "Kamalesh C", email: "chandran.kamalesh@gmail.com", phone: "8508654652", product: "A2_B1", day: "WEEKEND", b1: ["B09", "8:00 PM"], final: 37798, paid: 28347, method: "UPI", notes: "Jeffrin from Oct batch — free repetition" },
];

// ── May 2026 ───────────────────────────────────────────────────
const MAY_ADS: Spec[] = [
  { name: "Manojkumar", email: "Manojkumardmrp@gmail.com", phone: "9842225537", product: "A1_A2_B1", a1: ["B28", "7:00 PM"], final: 51999, paid: 19999, method: "UPI", due: "2026-07-11", ad: true },
  { name: "Harinie Jayaraman", email: "harinie30@gmail.com", phone: "8015689151", product: "A1_A2", a1: ["B27", "8:00 AM"], final: 32999, paid: 32999, method: "UPI", ad: true },
  { name: "Sathya", email: "sathyamohan188@gmail.com", phone: "9566786528", product: "A2_B1", a2: ["B18", "9:00 AM"], final: 39499, paid: 39499, method: "UPI", ad: true },
  { name: "Athulya", email: "athulyasurendran@gmail.com", phone: "7356152136", product: "A1_A2", a1: ["B28", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 32999, paid: 32999, method: "UPI", ad: true },
  { name: "Sathyaprasad", email: "sathyaprasad221@gmail.com", phone: "9344766599", product: "A1_A2", a1: ["B28", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 32999, paid: 32999, method: "Credit Card", ad: true },
  { name: "Joshua Michael", email: "joshuamichael080@gmail.com", phone: "1706616414", product: "A2_B1", a2: ["B18", "9:00 AM"], final: 40199, paid: 23999, method: "UPI", ad: true },
  { name: "Adelino", email: "navisadelino@gmail.com", phone: "9043604689", product: "A1", a1: ["B26", "7:00 AM"], final: 17499, paid: 17499, method: "UPI", ad: true },
  { name: "Jay", email: "Jayam28.mohan@gmail.com", phone: "+1 (862) 213-1140", product: "A1_A2", a1: ["B26", "7:00 AM"], final: 32999, paid: 20000, method: "UPI", due: "2026-07-11", ad: true },
  { name: "Shiva", email: "shivakannan819@gmail.com", phone: "9500785448", product: "A1_A2_B1", a1: ["B26", "7:00 AM"], a2: ["B19", "8:30 PM"], final: 48968, paid: 36999, method: "UPI", due: "2026-09-05", ad: true },
  { name: "Ramachandra", email: "rk80dba@gmail.com", phone: "919500032397", product: "A1_A2_B1", a1: ["B27", "8:00 AM"], final: 51999, paid: 20800, method: "UPI", status: "ON_HOLD", due: "2026-07-11", ad: true, notes: "On hold" },
];
const MAY_ORGANIC: Spec[] = [
  { name: "Ram Kumar", email: "ram.fist@gmail.com", phone: "7200639027", product: "A1_A2_B1", final: 48968, paid: 8162, method: "UPI · 6 EMI", due: "2026-06-14", notes: "Will join from August" },
  { name: "Yuvaraj", email: "yrajed@gmail.com", phone: "9677370071", product: "A1_A2_B1", a1: ["B26", "7:00 AM"], final: 48968, paid: 24486, method: "UPI · 6 EMI", due: "2026-08-07" },
  { name: "Thuhina", email: "thuhina18@gmail.com", phone: "9751319225", product: "A1_A2", a1: ["B26", "7:00 AM"], a2: ["B19", "8:30 PM"], final: 30598, paid: 30598, method: "UPI" },
  { name: "Sumithra", email: "sumitramahalingam@gmail.com", phone: "7904298773", product: "A1_A2", a1: ["B28", "7:00 PM"], a2: ["B19", "8:30 PM"], final: 30598, paid: 30598, method: "UPI" },
  { name: "Kameshwaran R", email: "kameshwaranr.198@gmail.com", phone: "9790061732", product: "A1_A2", a1: ["B27", "8:00 AM"], a2: ["B18", "9:00 AM"], final: 32587, paid: 32587, method: "Credit Card" },
  { name: "Kameshwaran S", phone: "9790347654", product: "A2_B1", a2: ["B19", "8:30 PM"], final: 37798, paid: 28350, method: "UPI · 4 EMI", due: "2026-08-07" },
  { name: "Roshan Kumar", email: "roshan.kumar558@gmail.com", phone: "9663572762", product: "A2_B1", a2: ["B19", "8:30 PM"], final: 38248, paid: 22949, method: "UPI", status: "ON_HOLD", due: "2026-07-11", notes: "On hold" },
];

function conversionData(s: Spec): Prisma.GnWorkshopConversionCreateWithoutWorkshopInput {
  return {
    fullName: s.name,
    email: s.email ?? null,
    phone: s.phone ?? null,
    product: s.product,
    dayType: s.day ?? "WEEKDAY",
    source: s.ad ? "AD" : "ORGANIC", // page-2 rows are ad-driven; page-3 are organic
    status: s.status ?? "CONFIRMED",
    isFreeSeat: s.free ?? false,
    batchA1: s.a1?.[0] ?? null,
    timeA1: s.a1?.[1] ?? null,
    batchA2: s.a2?.[0] ?? null,
    timeA2: s.a2?.[1] ?? null,
    batchB1: s.b1?.[0] ?? null,
    timeB1: s.b1?.[1] ?? null,
    finalPriceInrMinor: R(s.final),
    paidAmountInrMinor: R(s.paid),
    paymentMethod: s.method ?? null,
    nextDueDate: s.due ? day(s.due) : null,
    referralInrMinor: R(0),
    notes: s.notes ?? null,
  };
}

async function seedWorkshop(opts: {
  name: string;
  month: string;
  notes: string;
  specs: Spec[];
  adSets: { label: string; adSpend: number; reach: number; linkClicks: number; attended: number; conversions: number }[];
}) {
  await prisma.gnWorkshop.create({
    data: {
      name: opts.name,
      month: day(opts.month),
      notes: opts.notes,
      conversions: { create: opts.specs.map((s) => conversionData(s)) },
      adSets: {
        create: opts.adSets.map((a, i) => ({
          label: a.label,
          orderIndex: i,
          adSpendInrMinor: R(a.adSpend),
          reach: a.reach,
          linkClicks: a.linkClicks,
          attended: a.attended,
          conversions: a.conversions,
        })),
      },
    },
  });
  console.log(`  ✓ ${opts.name}: ${opts.specs.length} conversions, ${opts.adSets.length} ad-set(s)`);
}

async function main() {
  console.log("Seeding German Note workshops…");
  await prisma.gnWorkshop.deleteMany({ where: { name: { in: ["March 2026", "May 2026"] } } });

  await seedWorkshop({
    name: "March 2026",
    month: "2026-03-01",
    notes: "Reconstructed from the 03_26 workshop workbook. Delivery costs derive from the level cost model; ad spend is allocated automatically. Edit any row to refine.",
    specs: [...MARCH_ADS, ...MARCH_ORGANIC],
    adSets: [
      { label: "March campaign", adSpend: 24272.69, reach: 209108, linkClicks: 4883, attended: 223, conversions: 19 },
    ],
  });

  await seedWorkshop({
    name: "May 2026",
    month: "2026-05-01",
    notes: "Reconstructed from the 05_26 workshop workbook. Delivery costs derive from the level cost model; ad spend is allocated automatically. Edit any row to refine.",
    specs: [...MAY_ADS, ...MAY_ORGANIC],
    adSets: [
      { label: "Set A", adSpend: 12282.54, reach: 161654, linkClicks: 3214, attended: 80, conversions: 6 },
      { label: "Set B", adSpend: 12368.99, reach: 139794, linkClicks: 4031, attended: 33, conversions: 2 },
    ],
  });

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
