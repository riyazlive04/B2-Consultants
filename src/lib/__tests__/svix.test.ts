import test from "node:test";
import assert from "node:assert/strict";
import { signSvix, verifySvixSignature } from "../svix";

/**
 * This is the ONLY auth on `POST /api/resend/webhook`, a public endpoint that writes delivery
 * status onto `Message` rows - and until now it was hand-rolled crypto with no test at all. The
 * e2e access test does not cover it either: it asserts the route "refuses" a bogus signature and
 * counts 503 as a refusal, so it passed purely because the webhook was unconfigured in production.
 */

const SECRET = "whsec_" + Buffer.from("a-32-byte-test-signing-key-here!").toString("base64");
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "01a0f830-df4c-7da3" } });
const ID = "msg_2abc";
const NOW_MS = 1_760_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

test("accepts a correctly signed payload", () => {
  const sig = signSvix(BODY, ID, TS, SECRET);
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, SECRET, NOW_MS), true);
});

test("rejects a tampered body - the whole point of signing it", () => {
  const sig = signSvix(BODY, ID, TS, SECRET);
  const tampered = BODY.replace("email.delivered", "email.bounced");
  assert.equal(verifySvixSignature(tampered, ID, TS, sig, SECRET, NOW_MS), false);
});

test("rejects a signature lifted from a different message id", () => {
  const sig = signSvix(BODY, "msg_other", TS, SECRET);
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, SECRET, NOW_MS), false);
});

test("rejects the wrong secret", () => {
  const sig = signSvix(BODY, ID, TS, SECRET);
  const other = "whsec_" + Buffer.from("a-different-32-byte-signing-key!!").toString("base64");
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, other, NOW_MS), false);
});

test("replay window: 299s old passes, 301s old does not", () => {
  const sig = signSvix(BODY, ID, TS, SECRET);
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, SECRET, NOW_MS + 299_000), true);
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, SECRET, NOW_MS + 301_000), false);
  // Symmetric - a timestamp from the future is just as suspect.
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, SECRET, NOW_MS - 301_000), false);
});

test("rejects a non-numeric or empty timestamp", () => {
  const sig = signSvix(BODY, ID, TS, SECRET);
  assert.equal(verifySvixSignature(BODY, ID, "not-a-number", sig, SECRET, NOW_MS), false);
  assert.equal(verifySvixSignature(BODY, ID, "", sig, SECRET, NOW_MS), false);
});

test("accepts any entry during key rotation, and only a v1 one", () => {
  const good = signSvix(BODY, ID, TS, SECRET);
  const stale = "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  assert.equal(verifySvixSignature(BODY, ID, TS, `${stale} ${good}`, SECRET, NOW_MS), true);
  assert.equal(verifySvixSignature(BODY, ID, TS, `${good} ${stale}`, SECRET, NOW_MS), true);
  // A future scheme version must not be honoured by a v1 verifier.
  assert.equal(verifySvixSignature(BODY, ID, TS, good.replace("v1,", "v2,"), SECRET, NOW_MS), false);
});

test("rejects malformed signature headers without throwing", () => {
  for (const bad of ["", "garbage", "v1,", "v1,!!!not-base64!!!", ",", "v1", "v1,AAA"]) {
    assert.equal(verifySvixSignature(BODY, ID, TS, bad, SECRET, NOW_MS), false, `header: ${bad}`);
  }
});

test("rejects an empty secret rather than signing with a zero-length key", () => {
  // A blank RESEND_WEBHOOK_SECRET is caught by the route's 503 guard, but if that ever changed,
  // an empty HMAC key must not become a valid signature anyone could compute.
  const sig = signSvix(BODY, ID, TS, "whsec_");
  assert.equal(verifySvixSignature(BODY, ID, TS, sig, "whsec_", NOW_MS), false);
});
