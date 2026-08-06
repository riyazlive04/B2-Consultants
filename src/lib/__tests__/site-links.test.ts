import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildForwardedHref,
  isExternalHref,
  pickForwardable,
  SOURCE_PAGE_PARAM,
} from "../site-links";

describe("pickForwardable", () => {
  test("keeps utm and click ids, drops everything else", () => {
    const got = pickForwardable({
      utm_source: "facebook",
      utm_campaign: "lfmvp",
      fbclid: "abc123",
      gclid: "xyz",
      // not on the allow-list — internal state that must not reach a third-party host
      sessionId: "s-1",
      preview: "true",
    });
    assert.deepEqual(got, {
      utm_source: "facebook",
      utm_campaign: "lfmvp",
      fbclid: "abc123",
      gclid: "xyz",
    });
  });

  test("a repeated param takes the first value", () => {
    // ?utm_source=facebook&utm_source=google — the first is what the platform set.
    assert.equal(pickForwardable({ utm_source: ["facebook", "google"] }).utm_source, "facebook");
  });

  test("empty and missing values are skipped, not forwarded blank", () => {
    assert.deepEqual(pickForwardable({ utm_source: "", utm_medium: undefined }), {});
    assert.deepEqual(pickForwardable(undefined), {});
  });
});

describe("buildForwardedHref", () => {
  const incoming = { utm_source: "facebook", fbclid: "abc" };

  test("off by default — an unflagged link is returned untouched", () => {
    assert.equal(
      buildForwardedHref("https://optin.b2consultants.de/lp", { incoming }),
      "https://optin.b2consultants.de/lp",
    );
  });

  test("forwards onto the GHL funnel, the case this exists for", () => {
    const got = buildForwardedHref("https://optin.b2consultants.de/lp", {
      forwardParams: true,
      incoming,
      fromPath: "/",
    });
    const u = new URL(got);
    assert.equal(u.hostname, "optin.b2consultants.de");
    assert.equal(u.searchParams.get("utm_source"), "facebook");
    assert.equal(u.searchParams.get("fbclid"), "abc");
    assert.equal(u.searchParams.get(SOURCE_PAGE_PARAM), "/");
  });

  test("a param already on the href wins over the visitor's", () => {
    // The author wrote utm_campaign=spring on the button and meant it.
    const got = buildForwardedHref("https://optin.b2consultants.de/lp?utm_campaign=spring", {
      forwardParams: true,
      incoming: { utm_campaign: "inbound", utm_source: "facebook" },
    });
    const u = new URL(got);
    assert.equal(u.searchParams.get("utm_campaign"), "spring");
    assert.equal(u.searchParams.get("utm_source"), "facebook");
  });

  test("relative targets stay relative", () => {
    const got = buildForwardedHref("/career", { forwardParams: true, incoming, fromPath: "/" });
    assert.ok(got.startsWith("/career?"), `expected a relative href, got ${got}`);
    assert.ok(!got.includes("b2.invalid"), "the parsing base must never leak into the output");
  });

  test("preserves an existing hash", () => {
    const got = buildForwardedHref("/aboutus#contact", { forwardParams: true, incoming });
    assert.ok(got.includes("#contact"), got);
  });

  test("non-http schemes are left alone", () => {
    for (const href of ["mailto:info@b2consultants.de", "tel:+4915112345678"]) {
      assert.equal(buildForwardedHref(href, { forwardParams: true, incoming }), href);
    }
  });

  test("nothing to forward means no trailing '?'", () => {
    assert.equal(
      buildForwardedHref("https://optin.b2consultants.de/lp", { forwardParams: true, incoming: {} }),
      "https://optin.b2consultants.de/lp",
    );
  });

  test("fromPath alone is enough to stamp the origin", () => {
    // Organic visitor: no ad params at all, but which page sent them still matters.
    const u = new URL(
      buildForwardedHref("https://optin.b2consultants.de/lp", {
        forwardParams: true,
        incoming: {},
        fromPath: "/career",
      }),
    );
    assert.equal(u.searchParams.get(SOURCE_PAGE_PARAM), "/career");
  });

  test("an unparseable href is returned rather than thrown on", () => {
    assert.equal(buildForwardedHref("http://[bad", { forwardParams: true, incoming }), "http://[bad");
  });

  test("an empty href stays empty", () => {
    assert.equal(buildForwardedHref("", { forwardParams: true, incoming }), "");
  });
});

describe("isExternalHref", () => {
  test("relative hrefs are never external", () => {
    assert.equal(isExternalHref("/aboutus"), false);
    assert.equal(isExternalHref("#contact"), false);
  });

  test("the opt-in subdomain is external to the marketing site", () => {
    // Same registrable domain, different host — and it is a different platform entirely.
    assert.equal(isExternalHref("https://optin.b2consultants.de/lp", "b2consultants.de"), true);
  });

  test("our own domain is not external", () => {
    assert.equal(isExternalHref("https://b2consultants.de/career", "b2consultants.de"), false);
    assert.equal(isExternalHref("https://B2Consultants.DE/career", "b2consultants.de"), false);
  });

  test("with no domain configured yet, every absolute href counts as external", () => {
    assert.equal(isExternalHref("https://b2consultants.de/career", null), true);
  });
});
