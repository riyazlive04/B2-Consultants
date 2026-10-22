import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  buildTimestampRequest,
  parseGeneralizedTime,
  parseTimestampResponse,
} from "../rfc3161";

/**
 * The DER here is hand-written, so these tests check it against the structure RFC 3161 specifies,
 * byte by byte. A timestamp request that is subtly malformed does not fail loudly - authorities
 * reject it with a status code, or worse, accept it and timestamp the wrong digest.
 *
 * `scripts/verify-agreement-docs.ts` additionally round-trips a request through `openssl ts`
 * when OpenSSL is on the machine, which is the real proof that these bytes are what they claim.
 */

const digest = createHash("sha256").update("the sealed agreement bytes").digest();

test("a request is a well-formed TimeStampReq over the digest", () => {
  const nonce = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  const req = buildTimestampRequest(digest, nonce);

  // SEQUENCE, and the declared length matches what follows it.
  assert.equal(req[0], 0x30);
  const declared = req[1]! < 0x80 ? req[1]! : readLongLength(req);
  const headerLength = req[1]! < 0x80 ? 2 : 2 + (req[1]! & 0x7f);
  assert.equal(declared, req.length - headerLength, "the outer length must cover the whole body");

  // version v1
  assert.deepEqual([...req.subarray(headerLength, headerLength + 3)], [0x02, 0x01, 0x01]);

  // The SHA-256 algorithm identifier, then the digest itself, verbatim.
  const sha256Alg = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
  ]);
  assert.ok(req.includes(sha256Alg), "the sha256 AlgorithmIdentifier must be present");
  assert.ok(req.includes(Buffer.concat([Buffer.from([0x04, 0x20]), digest])), "the digest must be an OCTET STRING");

  // certReq TRUE, so the token carries the authority's certificate and verifies standalone.
  assert.deepEqual([...req.subarray(req.length - 3)], [0x01, 0x01, 0xff]);
});

test("a nonce with its top bit set does not become a negative INTEGER", () => {
  // 0xFF... is the case that breaks a naive encoder: DER integers are signed.
  const req = buildTimestampRequest(digest, Buffer.from([0xff, 0x00, 0x11, 0x22]));
  const marker = Buffer.from([0x02, 0x05, 0x00, 0xff, 0x00, 0x11, 0x22]);
  assert.ok(req.includes(marker), "a leading zero byte must be added to keep the nonce positive");
});

test("the digest has to be a SHA-256 one", () => {
  assert.throws(() => buildTimestampRequest(Buffer.alloc(20), randomBytes(8)), /32 bytes/);
});

// ───────────────────────────── Responses ─────────────────────────────

/** A minimal TimeStampResp: SEQUENCE { SEQUENCE { INTEGER status }, <token bytes> }. */
function response(status: number, token?: Buffer): Buffer {
  const statusInfo = Buffer.from([0x30, 0x03, 0x02, 0x01, status]);
  const body = token ? Buffer.concat([statusInfo, token]) : statusInfo;
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

test("a granted response hands back the token verbatim", () => {
  const token = Buffer.from([0x30, 0x06, 0x06, 0x04, 0xde, 0xad, 0xbe, 0xef]);
  const parsed = parseTimestampResponse(response(0, token));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.status, 0);
  assert.deepEqual([...parsed.token], [...token], "the stored token must be byte-identical to the reply");
});

test("grantedWithMods (1) is still a usable token", () => {
  const parsed = parseTimestampResponse(response(1, Buffer.from([0x30, 0x02, 0x05, 0x00])));
  assert.equal(parsed.ok, true);
});

test("a refusal is reported with the authority's reason, not swallowed", () => {
  const parsed = parseTimestampResponse(response(2));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.status, 2);
  assert.match(parsed.error, /rejected/);
});

test("granted but tokenless is a failure - there is nothing to store", () => {
  const parsed = parseTimestampResponse(response(0));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.error, /no token/);
});

test("rubbish in is a clean failure, never a throw", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from([0x05, 0x00]), randomBytes(64)]) {
    const parsed = parseTimestampResponse(bytes);
    // Random bytes could in principle parse; what must never happen is an exception.
    assert.equal(typeof parsed.ok, "boolean");
  }
});

test("genTime is read out of a token when one is in range", () => {
  const stamp = new Date();
  const text =
    `${stamp.getUTCFullYear()}` +
    `${String(stamp.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(stamp.getUTCDate()).padStart(2, "0")}` +
    `${String(stamp.getUTCHours()).padStart(2, "0")}` +
    `${String(stamp.getUTCMinutes()).padStart(2, "0")}` +
    `${String(stamp.getUTCSeconds()).padStart(2, "0")}Z`;
  const time = Buffer.concat([Buffer.from([0x18, text.length]), Buffer.from(text, "latin1")]);
  const token = Buffer.concat([Buffer.from([0x30, time.length]), time]);

  const parsed = parseTimestampResponse(response(0, token));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.ok(parsed.genTime, "a GeneralizedTime inside the token should be found");
  assert.ok(Math.abs(parsed.genTime!.getTime() - stamp.getTime()) < 1000);
});

test("a GeneralizedTime from another decade is ignored rather than believed", () => {
  // Certificates inside the token carry their own validity dates - those must not be mistaken
  // for the time the authority asserts.
  const text = "19990101000000Z";
  const time = Buffer.concat([Buffer.from([0x18, text.length]), Buffer.from(text, "latin1")]);
  const token = Buffer.concat([Buffer.from([0x30, time.length]), time]);
  const parsed = parseTimestampResponse(response(0, token));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.genTime, null);
});

test("GeneralizedTime parsing, including fractional seconds", () => {
  assert.deepEqual(parseGeneralizedTime("20261022091530Z"), new Date(Date.UTC(2026, 9, 22, 9, 15, 30)));
  assert.deepEqual(
    parseGeneralizedTime("20261022091530.5Z"),
    new Date(Date.UTC(2026, 9, 22, 9, 15, 30, 500)),
  );
  // Local-time forms are not valid DER and must not be guessed at.
  assert.equal(parseGeneralizedTime("20261022091530"), null);
  assert.equal(parseGeneralizedTime("nonsense"), null);
});

function readLongLength(buf: Buffer): number {
  const count = buf[1]! & 0x7f;
  let n = 0;
  for (let i = 0; i < count; i++) n = n * 256 + buf[2 + i]!;
  return n;
}
