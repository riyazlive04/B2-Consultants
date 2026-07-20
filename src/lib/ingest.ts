/**
 * The optional-ingest master switch (audit §D #28).
 *
 * The README long advertised `INGEST_ENABLED` as gating an optional Synamate/Razorpay/Sheets sync
 * that writes to the same tables with `source` + `manualOverride` — but NOTHING in the app ever
 * read the flag, so flipping it did nothing. This makes it a real, documented switch.
 *
 * What actually exists today:
 *   - Inbound leads arrive by signed WEBHOOK (Pabbly, Meta, FlexiFunnels) — always on, not gated.
 *   - One-shot manual backfills live in scripts/ (import-synamate.mjs) and are run by hand.
 * There is no scheduled pull-ingest yet. This flag is the seam a future scheduled importer must
 * check before writing, so it can be shipped dark and enabled per environment — exactly the
 * fail-closed, off-by-default contract every other integration here follows (WATI, email, SMS).
 *
 * Isomorphic + dependency-free so both server importers and any status UI can read one definition.
 */
export function ingestEnabled(): boolean {
  return process.env.INGEST_ENABLED?.trim().toLowerCase() === "true";
}
