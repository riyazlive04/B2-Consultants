import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { inrMinorToEurMinor, eurMinorToInrMinor } from "../fx";
import { aggEurMinor, aggInrMinor } from "../money";

/**
 * A MISSING EXCHANGE RATE MUST NOT CRASH A SCREEN.
 *
 * ── The bug ────────────────────────────────────────────────────────────────────────────
 * `fxRateUsed` is `0` on any row stored without one, which is the normal state for a
 * rupee-only payable. `inrMinorToEurMinor` divided by it, producing `Infinity`, and
 * `BigInt(Infinity)` throws - so ONE unconvertible row replaced the entire Cash Health page
 * with an error boundary.
 *
 * It was found on 24/10/2026 by opening every screen in the app with `npm run smoke`. Nothing
 * else could have: the throw is inside a pure function, reached only with data the unit tests
 * never supplied, and `tsc`, `next build` and 1,900 tests all passed throughout.
 *
 * ── Why zero rather than an exception ──────────────────────────────────────────────────
 * "How much is ₹50,000 in euros, with no rate to use" has no answer. Zero keeps the figure out
 * of the euro total instead of inventing one, and leaves the rupee side - which IS known -
 * untouched. Throwing is a worse answer to the same question, because it discards the rupee
 * figure too, along with every other row on the page.
 */

const rate = (v: string) => new Prisma.Decimal(v);
const FIFTY_K_RUPEES = BigInt(5_000_000); // paise
const HUNDRED_EUROS = BigInt(10_000); // cents

describe("converting with no usable rate", () => {
  test("a zero rate converts to zero instead of throwing", () => {
    // The exact shape that crashed: a rupee-only payable, rate column at its default of 0.
    assert.doesNotThrow(() => inrMinorToEurMinor(FIFTY_K_RUPEES, rate("0")));
    assert.equal(inrMinorToEurMinor(FIFTY_K_RUPEES, rate("0")), BigInt(0));
  });

  test("the other direction is guarded too, so a real bill is not valued at zero by surprise", () => {
    // Multiplying by zero never threw, which is why this half went unnoticed - it would have
    // quietly valued a €100 bill at ₹0.
    assert.equal(eurMinorToInrMinor(HUNDRED_EUROS, rate("0")), BigInt(0));
  });

  test("a negative rate is corrupt data, not a rate, and never flips the sign of money", () => {
    assert.equal(inrMinorToEurMinor(FIFTY_K_RUPEES, rate("-90")), BigInt(0));
    assert.equal(eurMinorToInrMinor(HUNDRED_EUROS, rate("-90")), BigInt(0));
  });

  test("a real rate still converts exactly as before", () => {
    // ₹50,000 at ₹100/€ is €500. Round-trips both ways.
    assert.equal(inrMinorToEurMinor(FIFTY_K_RUPEES, rate("100")), BigInt(50_000));
    assert.equal(eurMinorToInrMinor(BigInt(50_000), rate("100")), FIFTY_K_RUPEES);
  });
});

describe("the aggregates that sit on top of it", () => {
  test("a rupee-only row with no rate reports its rupees and no euros", () => {
    // This is the Cash Health payable row. The rupee side must survive the missing rate.
    assert.equal(aggInrMinor(FIFTY_K_RUPEES, BigInt(0), rate("0")), FIFTY_K_RUPEES);
    assert.equal(aggEurMinor(FIFTY_K_RUPEES, BigInt(0), rate("0")), BigInt(0));
  });

  test("a whole page's worth of unconvertible rows totals without throwing", () => {
    // Ten payables, every one of them rate-less - the exact state of the demo dataset, and what
    // Cash Health choked on.
    const rows = Array.from({ length: 10 }, () => ({
      inr: FIFTY_K_RUPEES,
      eur: BigInt(0),
      fx: rate("0"),
    }));
    assert.doesNotThrow(() => rows.map((r) => aggEurMinor(r.inr, r.eur, r.fx)));
    const totalInr = rows.reduce((a, r) => a + aggInrMinor(r.inr, r.eur, r.fx), BigInt(0));
    assert.equal(totalInr, FIFTY_K_RUPEES * BigInt(10));
  });

  test("a mixed row keeps the side it can convert", () => {
    // €100 + ₹50,000 at ₹100/€ = €600 / ₹60,000.
    assert.equal(aggEurMinor(FIFTY_K_RUPEES, HUNDRED_EUROS, rate("100")), BigInt(60_000));
    assert.equal(aggInrMinor(FIFTY_K_RUPEES, HUNDRED_EUROS, rate("100")), BigInt(6_000_000));
  });
});

describe("the demo dataset stamps a rate, so local data looks like real data", () => {
  test("every seeded payable carries fxRateUsed", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "..", "..", "..", "prisma", "demo-data.ts"), "utf8");
    const start = src.indexOf("await prisma.payable.createMany({");
    const end = src.indexOf("});", start);
    const block = src.slice(start, end);
    const rows = (block.match(/\{\s*name:/g) ?? []).length;
    const stamped = (block.match(/fxRateUsed: FX/g) ?? []).length;
    assert.ok(rows > 0, "the payable seed block moved - this test needs re-pointing");
    assert.equal(stamped, rows, `${rows - stamped} seeded payable(s) store no exchange rate`);
  });
});
