import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coercePublicLinksConfig,
  DEFAULT_PUBLIC_LINKS_CONFIG,
  publicLinksConfigSchema,
  type PublicLinksConfig,
} from "../config-schema";
import { LEAD_TEMPLATE_VARS } from "../whatsapp";

/**
 * The links behind `{{apply_url}}`, `{{sss_url}}` and `{{workshop_url}}`.
 *
 * ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────────────────────
 * These three are the only config values in the app whose EMPTINESS is a delivery failure rather
 * than a missing detail. `sendWhatsApp` skips any send whose declared variable resolves to
 * nothing, so a blank link here does not deliver a message without a link - it delivers no
 * message, silently, logged as a skip. Every assertion below is pointed at that one property.
 */
describe("public links config", () => {
  const KEYS = ["applyUrl", "sssUrl", "workshopUrl"] as const satisfies readonly (keyof PublicLinksConfig)[];

  it("ships defaults that are all usable https URLs", () => {
    // The lazy-default path: no stored row means these values are what gets sent. If any of them
    // were blank or http, the touchpoints carrying them would be dead on a fresh install.
    assert.ok(publicLinksConfigSchema.safeParse(DEFAULT_PUBLIC_LINKS_CONFIG).success);
    for (const k of KEYS) assert.match(DEFAULT_PUBLIC_LINKS_CONFIG[k], /^https:\/\/\S+$/);
  });

  it("never yields an empty value, whatever is in the row", () => {
    for (const junk of [null, undefined, {}, "", 0, [], "not json", { applyUrl: "" }, { sssUrl: null }]) {
      const got = coercePublicLinksConfig(junk);
      for (const k of KEYS) {
        assert.ok(got[k].length > 0, `${k} came back empty for ${JSON.stringify(junk)}`);
        assert.ok(got[k].startsWith("https://"), `${k} came back as "${got[k]}"`);
      }
    }
  });

  it("repairs one bad field without discarding the other two", () => {
    /**
     * The whole reason this coercer is field-by-field rather than the all-or-nothing safeParse
     * every other config uses. A row holding two good links and one typo used to revert ALL
     * three to the shipped defaults - so correcting a mistake in one field would silently undo
     * two deliberate edits, and the only symptom would be prospects arriving on the wrong page.
     */
    const got = coercePublicLinksConfig({
      applyUrl: "https://example.test/apply",
      sssUrl: "notaurl",
      workshopUrl: "https://example.test/workshop",
    });
    assert.equal(got.applyUrl, "https://example.test/apply", "a valid field must survive");
    assert.equal(got.workshopUrl, "https://example.test/workshop", "a valid field must survive");
    assert.equal(got.sssUrl, DEFAULT_PUBLIC_LINKS_CONFIG.sssUrl, "only the broken field is repaired");
  });

  it("rejects http and blanks on the WRITE path", () => {
    // The read path repairs; the write path must refuse, so a bad value never reaches the row in
    // the first place and the operator is told at the moment they can still fix it.
    for (const bad of ["", "   ", "http://optin.b2consultants.de/apply", "optin.b2consultants.de", "javascript:alert(1)"]) {
      const res = publicLinksConfigSchema.safeParse({ ...DEFAULT_PUBLIC_LINKS_CONFIG, applyUrl: bad });
      assert.equal(res.success, false, `"${bad}" should not be saveable`);
    }
  });

  it("is actually offered to the templates that carry it", () => {
    // A config nothing can bind to is inert. These three names are the contract with every
    // lead-facing touchpoint; dropping one from the pool would make its templates unbindable
    // while leaving this config looking perfectly healthy.
    for (const v of ["apply_url", "sss_url", "workshop_url"]) {
      assert.ok(LEAD_TEMPLATE_VARS.includes(v as never), `${v} must be in the lead variable pool`);
    }
  });
});
