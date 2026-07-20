/**
 * Student CSV import (spec Part 2 §9: "Export exists now; import is planned").
 *
 * Pure parsing + planning, no DB: the panel can show the founder exactly what WOULD happen
 * before anything is written. That preview is the whole design. An import that writes first
 * and reports afterwards is how a spreadsheet paste silently duplicates half a cohort.
 *
 * Matching is by EMAIL, folded to lowercase — the same key the rest of the app already
 * treats as a person's identity (see booking-actions on why the fold matters). A row with no
 * email cannot be matched to anyone, so it can only ever create.
 */

export type ImportRow = {
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type RowPlan =
  | { kind: "create"; row: ImportRow; line: number }
  | { kind: "update"; row: ImportRow; line: number; studentId: string; changes: string[] }
  | { kind: "unchanged"; row: ImportRow; line: number; studentId: string }
  | { kind: "skip"; line: number; reason: string; raw: string };

export type ImportPlan = {
  plans: RowPlan[];
  creates: number;
  updates: number;
  unchanged: number;
  skipped: number;
};

/** Columns we understand. Header matching is case/space-insensitive. */
const COLUMN_ALIASES: Record<string, keyof ImportRow> = {
  name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  student: "fullName",
  email: "email",
  "email id": "email",
  emailid: "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  whatsapp: "phone",
  address: "address",
};

/**
 * Split one CSV line, honouring double-quoted fields.
 *
 * Hand-rolled rather than split(",") because addresses contain commas — the single most
 * likely field in this import to be quoted, and the one that would silently shift every
 * later column if we ignored quoting.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'; // escaped quote
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

export type ParseResult =
  | { ok: true; rows: { row: ImportRow; line: number }[]; skipped: { line: number; reason: string; raw: string }[] }
  | { ok: false; error: string };

/** Parse a CSV into candidate rows. Bad rows are collected, not fatal — one typo shouldn't reject the file. */
export function parseStudentCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { ok: false, error: "The file is empty" };

  const header = parseCsvLine(lines[0]).map((h) => COLUMN_ALIASES[norm(h)]);
  if (!header.includes("fullName")) {
    return { ok: false, error: "No name column found. The file needs a header row with at least a 'name' column." };
  }

  const rows: { row: ImportRow; line: number }[] = [];
  const skipped: { line: number; reason: string; raw: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cells = parseCsvLine(raw);
    const rec: ImportRow = { fullName: "", email: null, phone: null, address: null };
    header.forEach((key, idx) => {
      if (!key) return;
      const v = clean(cells[idx]);
      if (key === "email") rec.email = v ? v.toLowerCase() : null;
      else if (key === "fullName") rec.fullName = v ?? "";
      else rec[key] = v;
    });

    if (!rec.fullName) {
      skipped.push({ line: i + 1, reason: "No name", raw });
      continue;
    }
    if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) {
      skipped.push({ line: i + 1, reason: `Invalid email "${rec.email}"`, raw });
      continue;
    }
    rows.push({ row: rec, line: i + 1 });
  }
  return { ok: true, rows, skipped };
}

export type ExistingStudent = {
  id: string;
  email: string | null;
  fullName: string;
  phone: string | null;
  address: string | null;
};

/**
 * Decide what each row would do, given who already exists.
 *
 * An update only ever FILLS or CORRECTS the four intake fields, and `unchanged` is reported
 * separately from `update` so a re-imported file reads as "nothing to do" rather than
 * inflating a change count nobody made.
 *
 * A blank cell means "no data in the sheet", never "delete what's on file" — an import is
 * usually a partial export, and treating gaps as deletions would quietly strip phone numbers
 * off half the roster.
 */
export function planStudentImport(
  parsed: { row: ImportRow; line: number }[],
  existing: ExistingStudent[],
  skipped: { line: number; reason: string; raw: string }[] = [],
): ImportPlan {
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e]));
  const plans: RowPlan[] = [];
  const seenEmails = new Set<string>();

  for (const { row, line } of parsed) {
    // A file that lists the same person twice would otherwise create them twice.
    if (row.email) {
      if (seenEmails.has(row.email)) {
        plans.push({ kind: "skip", line, reason: `Duplicate of an earlier row (${row.email})`, raw: row.fullName });
        continue;
      }
      seenEmails.add(row.email);
    }

    const match = row.email ? byEmail.get(row.email) : undefined;
    if (!match) {
      plans.push({ kind: "create", row, line });
      continue;
    }

    const changes: string[] = [];
    if (row.fullName && row.fullName !== match.fullName) changes.push("name");
    if (row.phone && row.phone !== match.phone) changes.push("phone");
    if (row.address && row.address !== match.address) changes.push("address");

    if (changes.length === 0) plans.push({ kind: "unchanged", row, line, studentId: match.id });
    else plans.push({ kind: "update", row, line, studentId: match.id, changes });
  }

  for (const s of skipped) plans.push({ kind: "skip", line: s.line, reason: s.reason, raw: s.raw });
  plans.sort((a, b) => a.line - b.line);

  return {
    plans,
    creates: plans.filter((p) => p.kind === "create").length,
    updates: plans.filter((p) => p.kind === "update").length,
    unchanged: plans.filter((p) => p.kind === "unchanged").length,
    skipped: plans.filter((p) => p.kind === "skip").length,
  };
}
