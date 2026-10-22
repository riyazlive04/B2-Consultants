import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { toOwnedBytes } from "@/lib/agreement-token";
import {
  buildTimestampRequest,
  parseTimestampResponse,
  TIMESTAMP_CONTENT_TYPE,
  TIMESTAMP_REPLY_TYPE,
} from "@/lib/rfc3161";
import { recordAgreementEvent } from "./agreement-core";

/**
 * Getting a timestamp authority to attest to a sealed agreement.
 *
 * ── WHERE THIS SITS IN THE ORDER, AND WHY ───────────────────────────────────────────────────
 * AFTER sealing, always. A timestamp is over the FINAL bytes, so it cannot exist before them -
 * which is why `tsToken`/`tsAuthority`/`tsGenTime`/`tsError` are the only columns on a signed
 * agreement that `agreement_seal_guard` deliberately leaves writable. Everything else about the
 * row is frozen the instant `signedAt` is set.
 *
 * ── OFF UNTIL CONFIGURED, LIKE EVERY OTHER OUTBOUND SEAM HERE ───────────────────────────────
 * No `AGREEMENT_TSA_URL`, no timestamping. This is a request to a third party carrying a hash of a
 * contract, so it is not something to start doing because an upgrade shipped: the founder chooses
 * the authority. The hash is all that leaves - never the document, never the parties, never the
 * terms - but the choice is still theirs.
 *
 * ── A FAILURE IS NEVER FATAL ────────────────────────────────────────────────────────────────
 * The signature is already sealed by the time this runs. A TSA that is down, slow or refusing
 * must not cost the student a signature they have made - so every failure is caught, written to
 * `tsError` so it is explicable on screen, and retried by the daily sweep.
 */

const REQUEST_TIMEOUT_MS = 8_000;

export type TimestampConfig = { url: string; name: string };

/**
 * The authority, from the environment.
 *
 * `AGREEMENT_TSA_NAME` is cosmetic - it is printed beside the token on the founder's screen so
 * somebody reading it later knows whose certificate verifies it - and defaults to the URL's host,
 * which is the honest answer when nobody set a nicer one.
 */
export function timestampConfig(): TimestampConfig | null {
  const url = process.env.AGREEMENT_TSA_URL?.trim();
  if (!url || !/^https:\/\//i.test(url)) return null;
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  return { url, name: process.env.AGREEMENT_TSA_NAME?.trim() || host };
}

export type TimestampOutcome =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; authority: string; genTime: Date | null }
  | { ok: false; error: string };

/**
 * Timestamp one sealed agreement.
 *
 * Idempotent: an agreement that already holds a token is left alone, so the sweep can run over
 * the same rows every day without asking an authority to re-attest what it has already attested.
 */
export async function timestampAgreement(agreementId: string): Promise<TimestampOutcome> {
  const config = timestampConfig();
  if (!config) return { ok: true, skipped: true, reason: "No timestamp authority is configured." };

  const row = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: { id: true, documentNo: true, pdfSha256: true, signedAt: true, tsToken: true },
  });
  if (!row) return { ok: false, error: "Agreement not found." };
  if (!row.signedAt || !row.pdfSha256) {
    return { ok: true, skipped: true, reason: "Only a sealed agreement can be timestamped." };
  }
  if (row.tsToken) return { ok: true, skipped: true, reason: "Already timestamped." };

  const digest = Buffer.from(row.pdfSha256, "hex");
  if (digest.length !== 32) return { ok: false, error: "The stored PDF hash is not a SHA-256." };

  const request = buildTimestampRequest(digest, randomBytes(8));

  let reply: Buffer;
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": TIMESTAMP_CONTENT_TYPE, accept: TIMESTAMP_REPLY_TYPE },
      body: new Uint8Array(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return await fail(agreementId, `${config.name} answered ${res.status}`);
    }
    reply = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const message = e instanceof Error ? e.message : "request failed";
    return await fail(agreementId, `${config.name}: ${message}`);
  }

  const parsed = parseTimestampResponse(reply);
  if (!parsed.ok) return await fail(agreementId, `${config.name}: ${parsed.error}`);

  /**
   * `tsToken: null` in the WHERE clause is a compare-and-set.
   *
   * Two sweeps overlapping, or a sweep racing the signing path, would otherwise overwrite a good
   * token with a second one - and the first is the one whose time is closest to the signature.
   */
  const stored = await prisma.agreement.updateMany({
    where: { id: agreementId, tsToken: null },
    data: {
      tsToken: toOwnedBytes(parsed.token),
      tsAuthority: config.name,
      tsGenTime: parsed.genTime,
      tsError: null,
    },
  });
  if (stored.count === 0) return { ok: true, skipped: true, reason: "Already timestamped." };

  await recordAgreementEvent(agreementId, "TIMESTAMPED", {
    meta: {
      authority: config.name,
      url: config.url,
      genTime: parsed.genTime?.toISOString() ?? null,
      status: parsed.status,
      bytes: parsed.token.length,
      // The hash that was attested to, so the trail says WHAT was timestamped, not just that it was.
      pdfSha256: row.pdfSha256,
    },
  });

  return { ok: true, skipped: false, authority: config.name, genTime: parsed.genTime };
}

/**
 * Record why it did not work, and carry on.
 *
 * Written to the row rather than only logged: "not timestamped" and "we tried and the authority
 * was down" look identical on a screen otherwise, and the second one is the founder's to chase.
 */
async function fail(agreementId: string, error: string): Promise<TimestampOutcome> {
  await prisma.agreement
    .updateMany({ where: { id: agreementId, tsToken: null }, data: { tsError: error.slice(0, 300) } })
    .catch(() => undefined);
  return { ok: false, error };
}

/**
 * Catch up on anything that missed its timestamp - a TSA outage, a deploy mid-signature, or
 * agreements signed before an authority was configured at all.
 *
 * Runs on the daily agreements cron. Bounded per run: this is an outbound call per row, and a
 * backlog of a hundred is better cleared over a week of ticks than in one burst at a third party.
 */
export async function runTimestampSweep(limit = 20): Promise<{
  configured: boolean;
  attempted: number;
  stamped: number;
  failed: number;
  details: string[];
}> {
  const config = timestampConfig();
  if (!config) return { configured: false, attempted: 0, stamped: 0, failed: 0, details: [] };

  const rows = await prisma.agreement.findMany({
    where: { signedAt: { not: null }, pdfSha256: { not: null }, tsToken: null },
    select: { id: true, documentNo: true },
    orderBy: { signedAt: "desc" },
    take: limit,
  });

  const out = { configured: true, attempted: rows.length, stamped: 0, failed: 0, details: [] as string[] };
  for (const row of rows) {
    const result = await timestampAgreement(row.id);
    if (result.ok && !result.skipped) {
      out.stamped++;
      out.details.push(`${row.documentNo}: timestamped by ${result.authority}`);
    } else if (!result.ok) {
      out.failed++;
      out.details.push(`${row.documentNo}: ${result.error}`);
    }
  }
  return out;
}
