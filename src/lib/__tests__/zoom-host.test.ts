import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coerceZoomConfig, zoomHostFor, DEFAULT_ZOOM_CONFIG, type ZoomConfig } from "../config-schema";

/**
 * Who hosts a call, decided from the founder's mapping alone.
 *
 * The fallback chain is the whole point: an unmapped person must still get a WORKING link, so
 * every branch here ends somewhere real rather than throwing or returning a blank host. `null`
 * means "the Zoom account owner", which the transport layer spells `me`.
 */

const cfg = (over: Partial<ZoomConfig> = {}): ZoomConfig => ({ ...DEFAULT_ZOOM_CONFIG, ...over });

describe("zoomHostFor - which Zoom account runs a call", () => {
  it("uses the person's own mapping when there is one", () => {
    const c = cfg({ hosts: [{ userId: "u-asma", email: "asma@b2.de" }] });
    assert.equal(zoomHostFor(c, "u-asma"), "asma@b2.de");
  });

  it("falls back to the default for someone unmapped", () => {
    const c = cfg({ defaultHostEmail: "calls@b2.de", hosts: [{ userId: "u-asma", email: "asma@b2.de" }] });
    assert.equal(zoomHostFor(c, "u-nilofer"), "calls@b2.de");
  });

  it("falls back to the account owner when nothing is configured at all", () => {
    assert.equal(zoomHostFor(cfg(), "u-asma"), null);
  });

  it("uses the default for an UNASSIGNED slot, not the first mapped person", () => {
    // A slot with no assignee is common (the manual generator leaves it blank). Picking an
    // arbitrary host for it would put a stranger's prospect on somebody's calendar.
    const c = cfg({ defaultHostEmail: "calls@b2.de", hosts: [{ userId: "u-asma", email: "asma@b2.de" }] });
    assert.equal(zoomHostFor(c, null), "calls@b2.de");
    assert.equal(zoomHostFor(c, undefined), "calls@b2.de");
    assert.equal(zoomHostFor(c, ""), "calls@b2.de");
  });

  it("treats a whitespace-only mapping as unmapped rather than as a host", () => {
    // "   " would otherwise be sent to Zoom as a user id and fail the create outright.
    const c = cfg({ defaultHostEmail: "calls@b2.de", hosts: [{ userId: "u-asma", email: "   " }] });
    assert.equal(zoomHostFor(c, "u-asma"), "calls@b2.de");
  });

  it("prefers the first mapping if a userId somehow appears twice", () => {
    // The console cannot produce this, but a hand-edited document can, and a silent coin-flip
    // between two hosts is the worst possible answer.
    const c = cfg({
      hosts: [
        { userId: "u-asma", email: "first@b2.de" },
        { userId: "u-asma", email: "second@b2.de" },
      ],
    });
    assert.equal(zoomHostFor(c, "u-asma"), "first@b2.de");
  });
});

describe("coerceZoomConfig - surviving a bad document", () => {
  it("reads a well-formed document", () => {
    const parsed = coerceZoomConfig({ defaultHostEmail: "calls@b2.de", hosts: [{ userId: "u1", email: "a@b.de" }] });
    assert.equal(parsed.defaultHostEmail, "calls@b2.de");
    assert.equal(parsed.hosts.length, 1);
  });

  it("falls back to the shipped default rather than throwing on junk", () => {
    // The whole booking path reads this. A corrupt row must cost a link, never a booking.
    for (const junk of [null, undefined, 42, "nope", { hosts: "not-an-array" }, { hosts: [{ userId: "u1" }] }]) {
      assert.deepEqual(coerceZoomConfig(junk), DEFAULT_ZOOM_CONFIG);
    }
  });

  it("refuses a host row whose email is not an email", () => {
    assert.deepEqual(coerceZoomConfig({ hosts: [{ userId: "u1", email: "not-an-email" }] }), DEFAULT_ZOOM_CONFIG);
  });

  it("accepts an empty default (meaning: the account owner) but not a malformed one", () => {
    assert.equal(coerceZoomConfig({ defaultHostEmail: "" }).defaultHostEmail, "");
    assert.deepEqual(coerceZoomConfig({ defaultHostEmail: "bogus" }), DEFAULT_ZOOM_CONFIG);
  });
});
