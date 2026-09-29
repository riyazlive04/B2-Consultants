import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, countryByIso, flagOf, joinPhone, splitPhone } from "../phone-countries";

describe("flagOf", () => {
  test("derives the flag from the ISO code", () => {
    assert.equal(flagOf("IN"), "🇮🇳");
    assert.equal(flagOf("de"), "🇩🇪");
  });
  test("returns nothing for a non-code rather than mangling it", () => {
    assert.equal(flagOf("XYZ"), "");
    assert.equal(flagOf(""), "");
  });
});

describe("the country list", () => {
  test("puts the markets this business serves first", () => {
    assert.deepEqual(COUNTRIES.slice(0, 5).map((c) => c.iso2), ["IN", "DE", "AE", "GB", "US"]);
  });
  test("has no duplicate ISO codes", () => {
    assert.equal(new Set(COUNTRIES.map((c) => c.iso2)).size, COUNTRIES.length);
  });
  test("every dial code is digits only", () => {
    const bad = COUNTRIES.filter((c) => !/^\d{1,4}$/.test(c.dial));
    assert.deepEqual(bad, []);
  });
  test("covers the markets the funnel actually takes traffic from", () => {
    for (const iso of ["IN", "DE", "AE", "GB", "US", "SA", "QA", "SG", "AU", "CA", "NG", "ZA", "PH"]) {
      assert.ok(COUNTRIES.some((c) => c.iso2 === iso), `${iso} missing`);
    }
  });
});

describe("splitPhone", () => {
  test("splits a stored international number", () => {
    assert.deepEqual(splitPhone("+91 9789961631"), { iso2: "IN", national: "9789961631" });
    assert.deepEqual(splitPhone("+49 15123456789"), { iso2: "DE", national: "15123456789" });
  });

  test("prefers the LONGEST matching dial code", () => {
    // +1 is the United States and +1868 is Trinidad. Matching the short one first would file
    // every Caribbean number under the US - and then dial it wrong.
    assert.equal(splitPhone("+1868 2911234").iso2, "TT");
    assert.equal(splitPhone("+1 4155550123").iso2, "US");
    assert.equal(splitPhone("+1876 5551234").iso2, "JM");
  });

  test("a bare local number is left alone under the fallback country", () => {
    assert.deepEqual(splitPhone("9789961631"), { iso2: "IN", national: "9789961631" });
    assert.deepEqual(splitPhone("07899 61631", "GB"), { iso2: "GB", national: "07899 61631" });
  });

  test("tolerates the spacing and punctuation people actually type", () => {
    assert.deepEqual(splitPhone("+91-97899-61631"), { iso2: "IN", national: "9789961631" });
    assert.deepEqual(splitPhone("  +91 97899 61631  "), { iso2: "IN", national: "9789961631" });
  });

  test("an empty value stays empty rather than becoming a lone dial code", () => {
    assert.deepEqual(splitPhone(""), { iso2: "IN", national: "" });
  });
});

describe("joinPhone", () => {
  test("recombines into the stored shape", () => {
    assert.equal(joinPhone("IN", "9789961631"), "+91 9789961631");
    assert.equal(joinPhone("DE", "151 2345 6789"), "+49 15123456789");
  });
  test("an empty number produces an empty answer, not a bare +91", () => {
    // Otherwise every untouched optional phone field would submit "+91" and read as answered.
    assert.equal(joinPhone("IN", ""), "");
    assert.equal(joinPhone("IN", "   "), "");
  });
  test("round-trips", () => {
    for (const v of ["+91 9789961631", "+49 15123456789", "+1868 2911234", "+44 7700900123"]) {
      const { iso2, national } = splitPhone(v);
      assert.equal(joinPhone(iso2, national), v);
    }
  });
});

describe("countryByIso", () => {
  test("falls back to India rather than crashing on an unknown code", () => {
    assert.equal(countryByIso("ZZ").iso2, "IN");
    assert.equal(countryByIso(undefined).iso2, "IN");
  });
});
