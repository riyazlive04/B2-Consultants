import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * "Who is in here twice?" — the report that did not exist.
 *
 * ── The gap ─────────────────────────────────────────────────────────────────────
 * Duplicate detection was WRITE-TIME ONLY: `findDuplicateLead` blocks a new manual entry, and
 * `upsertIntakeLead` links a returning opt-in to the existing row. Neither could tell you about
 * the duplicates ALREADY in the table — and there was no reason to think the table was clean,
 * since 23,429 of 23,545 leads arrived through a one-shot Synamate import that ran outside both
 * paths entirely.
 *
 * ── Why the matching is done in SQL ─────────────────────────────────────────────
 * Pairwise comparison in JS over 23.5k rows is 276 million comparisons. Postgres can group by a
 * normalised expression in one pass, so each rule below is a single indexed-ish scan. The phone
 * rule strips non-digits and compares the last 10 significant digits, which is the same identity
 * `normalizeWhatsappNumber` resolves to for Indian numbers — close enough to SURFACE a candidate
 * pair, and a human confirms before anything is merged.
 *
 * ── The rule that matters ───────────────────────────────────────────────────────
 * A BLANK key is never a match. 5,889 leads carry no phone at all; grouping them on "" would
 * report one 5,889-row "duplicate" — absence of a number is not evidence of sameness. Every rule
 * below excludes empty values explicitly.
 */

export type DuplicateEntity = "lead" | "student" | "user";

export type DuplicateMember = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Lead only — where they sit now, so a human can tell which row is the live one. */
  stage: string | null;
  ownerName: string | null;
  createdAt: Date;
  /** Activity counts: the row with the history is almost always the one to KEEP. */
  calls: number;
  bookings: number;
  opportunities: number;
};

export type DuplicateGroup = {
  /** The normalised value they collided on — shown so the match is auditable, never guessed at. */
  key: string;
  on: "phone" | "email" | "name";
  members: DuplicateMember[];
};

export type DuplicatesReport = {
  leads: DuplicateGroup[];
  students: DuplicateGroup[];
  users: DuplicateGroup[];
  /** Leads with no phone AND no email — undedupable by construction; worth knowing the size of. */
  unidentifiableLeads: number;
  /** True when a rule hit its cap, so the UI never implies the list is exhaustive. */
  truncated: boolean;
};

/** Bounded: this is a review queue a human works through, not a data dump. */
const MAX_GROUPS = 200;

type KeyRow = { key: string; ids: string[] };

async function leadGroupsByPhone(): Promise<KeyRow[]> {
  return prisma.$queryRaw<KeyRow[]>`
    SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) AS key,
           array_agg(id ORDER BY "createdAt" ASC) AS ids
    FROM "lead"
    WHERE "deletedAt" IS NULL
      AND phone IS NOT NULL
      -- 10 significant digits or it is not selective enough to assert identity on.
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT ${MAX_GROUPS}
  `;
}

async function leadGroupsByEmail(): Promise<KeyRow[]> {
  return prisma.$queryRaw<KeyRow[]>`
    SELECT lower(btrim(email)) AS key,
           array_agg(id ORDER BY "createdAt" ASC) AS ids
    FROM "lead"
    WHERE "deletedAt" IS NULL AND email IS NOT NULL AND btrim(email) <> ''
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT ${MAX_GROUPS}
  `;
}

/**
 * Name + city, for the population that has NEITHER a phone nor an email.
 *
 * Weaker evidence than the other two and deliberately last: two real people can share a name.
 * It exists because the phoneless population is 5,889 rows, which the phone and email rules
 * cannot see at all — reporting nothing about a quarter of the table would be its own kind of
 * lie. The UI labels these as "possible", not "duplicate".
 */
async function leadGroupsByName(): Promise<KeyRow[]> {
  return prisma.$queryRaw<KeyRow[]>`
    SELECT lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) || '|' || lower(coalesce(city, '')) AS key,
           array_agg(id ORDER BY "createdAt" ASC) AS ids
    FROM "lead"
    WHERE "deletedAt" IS NULL
      AND (phone IS NULL OR btrim(phone) = '')
      AND (email IS NULL OR btrim(email) = '')
      AND length(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) >= 4
      -- PLACEHOLDER NAMES ARE NOT PEOPLE. Live carries six leads literally called "noname";
      -- grouping them reports one six-way "duplicate" that is really six unrelated strangers
      -- whose name was never captured. A report whose first entry is always wrong is a report
      -- nobody opens twice.
      AND lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) NOT IN (
        'noname', 'unknown', 'test', 'testing', 'null', 'none', 'nil', 'na', 'nan',
        'anonymous', 'customer', 'user', 'lead', 'client', 'student'
      )
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT ${MAX_GROUPS}
  `;
}

/** Hydrate the grouped ids into rows a human can judge. */
async function hydrateLeadGroups(rows: KeyRow[], on: DuplicateGroup["on"]): Promise<DuplicateGroup[]> {
  const ids = rows.flatMap((r) => r.ids);
  if (!ids.length) return [];

  const leads = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, phone: true, email: true, stage: true, createdAt: true,
      assignedTo: { select: { name: true } },
      // The counts are the decision: the row carrying the calls and the booking is the one to
      // keep, and merging into the wrong direction silently orphans that history.
      _count: { select: { callLogs: true, bookings: true, opportunities: true } },
    },
  });
  const byId = new Map(leads.map((l) => [l.id, l]));

  return rows
    .map((r) => ({
      key: r.key,
      on,
      members: r.ids
        .map((id) => byId.get(id))
        .filter((l): l is NonNullable<typeof l> => Boolean(l))
        .map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          stage: l.stage as string,
          ownerName: l.assignedTo?.name ?? null,
          createdAt: l.createdAt,
          calls: l._count.callLogs,
          bookings: l._count.bookings,
          opportunities: l._count.opportunities,
        })),
    }))
    // A group can drop below 2 if a row was archived between the GROUP BY and the hydrate.
    .filter((g) => g.members.length > 1);
}

export async function getDuplicatesReport(): Promise<DuplicatesReport> {
  const [phoneRows, emailRows, nameRows, unidentifiableLeads, studentRows, userRows] = await Promise.all([
    leadGroupsByPhone(),
    leadGroupsByEmail(),
    leadGroupsByName(),
    prisma.lead.count({
      where: {
        deletedAt: null,
        OR: [{ phone: null }, { phone: "" }],
        AND: [{ OR: [{ email: null }, { email: "" }] }],
      },
    }),
    /**
     * Students, matched on email.
     *
     * The more damaging duplicate of the two: a student in twice splits their payments, their
     * agreement, their tracker and their LTV across two records, and Finance then reports both
     * as separate customers.
     */
    prisma.$queryRaw<KeyRow[]>`
      SELECT lower(btrim(email)) AS key, array_agg(id ORDER BY "createdAt" ASC) AS ids
      FROM "student"
      WHERE email IS NOT NULL AND btrim(email) <> ''
      GROUP BY 1 HAVING count(*) > 1
      ORDER BY count(*) DESC LIMIT ${MAX_GROUPS}
    `,
    /**
     * Logins. `User.email` is `@unique`, so an exact collision is impossible — this catches the
     * CASE-VARIANT one the unique index does not, which is exactly the kind that produces "my
     * password stopped working" (see lib/credentials.ts).
     */
    prisma.$queryRaw<KeyRow[]>`
      SELECT lower(btrim(email)) AS key, array_agg(id ORDER BY "createdAt" ASC) AS ids
      FROM "user"
      GROUP BY 1 HAVING count(*) > 1
      ORDER BY count(*) DESC LIMIT ${MAX_GROUPS}
    `,
  ]);

  const [byPhone, byEmail, byName] = await Promise.all([
    hydrateLeadGroups(phoneRows, "phone"),
    hydrateLeadGroups(emailRows, "email"),
    hydrateLeadGroups(nameRows, "name"),
  ]);

  // Phone first — it is the strongest evidence, and it is the identity every other part of the
  // app (WhatsApp, dedupe, the SOP) actually keys on.
  const seen = new Set<string>();
  const leads: DuplicateGroup[] = [];
  for (const g of [...byPhone, ...byEmail, ...byName]) {
    // A pair caught by phone AND email is one duplicate, not two. Keyed on the member set so the
    // stronger rule's version of the group is the one kept.
    const sig = g.members.map((m) => m.id).sort().join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    leads.push(g);
  }

  const hydrateSimple = async (
    rows: KeyRow[],
    table: "student" | "user",
  ): Promise<DuplicateGroup[]> => {
    const ids = rows.flatMap((r) => r.ids);
    if (!ids.length) return [];
    const found =
      table === "student"
        ? await prisma.student.findMany({
            where: { id: { in: ids } },
            select: { id: true, fullName: true, phone: true, email: true, createdAt: true },
          })
        : await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, email: true, createdAt: true },
          });
    const byId = new Map<string, DuplicateMember>(
      found.map((f) => [
        f.id,
        {
          id: f.id,
          name: "fullName" in f ? f.fullName : f.name,
          phone: "phone" in f ? f.phone : null,
          email: f.email,
          stage: null,
          ownerName: null,
          createdAt: f.createdAt,
          // Students and users have no lead-side activity to weigh — the counts stay zero and
          // the UI hides the column for these tabs rather than showing three misleading noughts.
          calls: 0,
          bookings: 0,
          opportunities: 0,
        },
      ]),
    );
    return rows
      .map((r) => ({
        key: r.key,
        on: "email" as const,
        members: r.ids
          .map((id) => byId.get(id))
          .filter((m): m is DuplicateMember => m !== undefined),
      }))
      .filter((g) => g.members.length > 1);
  };

  const [students, users] = await Promise.all([
    hydrateSimple(studentRows, "student"),
    hydrateSimple(userRows, "user"),
  ]);

  return {
    leads,
    students,
    users,
    unidentifiableLeads,
    truncated:
      phoneRows.length >= MAX_GROUPS ||
      emailRows.length >= MAX_GROUPS ||
      nameRows.length >= MAX_GROUPS,
  };
}
