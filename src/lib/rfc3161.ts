/**
 * RFC 3161 trusted timestamps - the request, and just enough of the response.
 *
 * ── WHAT THIS BUYS, IN ONE PARAGRAPH ────────────────────────────────────────────────────────
 * A sealed agreement already carries two hashes: `dataSha256` (reproducible - it proves WHAT was
 * agreed) and `pdfSha256` (of the stored bytes - it proves the artifact is untouched). Both are
 * assertions BY B2, kept in B2's database. A timestamp token is the first claim on the record that
 * a third party makes: a timestamp authority signs "these exact bytes were presented to me at this
 * moment", and that survives B2's database entirely. It is the cheap half of what a qualified
 * e-signature provider sells, and the half that matters most in a dispute about WHEN.
 *
 * ── WHY HAND-ROLLED DER AND NOT A LIBRARY ───────────────────────────────────────────────────
 * The request is four fields and about forty bytes of structure, and the only part of the response
 * this codebase interprets is a status integer. The alternative is a general-purpose ASN.1/CMS
 * dependency - a large parser, run over bytes from an external service, to read one number. The
 * token itself is stored VERBATIM and never re-encoded, so nothing here has to understand CMS for
 * the artifact to be valid: verification is done by `openssl ts -verify` against the authority's
 * certificate, by whoever is checking, years from now.
 *
 * Pure and isomorphic apart from the hash input, which the caller supplies.
 */

// ───────────────────────────── Minimal DER writer ─────────────────────────────

/** Length in DER's short/long form. Lengths above 2^24 cannot occur here. */
function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x81, n]);
  if (n <= 0xffff) return Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.from([0x83, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), len(value.length), value]);
}

const SEQUENCE = 0x30;
const INTEGER = 0x02;
const OCTET_STRING = 0x04;
const NULL = 0x05;
const OID = 0x06;
const BOOLEAN = 0x01;
const GENERALIZED_TIME = 0x18;

/** 2.16.840.1.101.3.4.2.1 - sha256, pre-encoded; there is one hash algorithm here and it is this. */
const SHA256_OID = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

/**
 * A DER INTEGER is SIGNED, so a value whose top bit is set needs a leading zero or it reads as
 * negative - and a negative nonce is rejected by some authorities and silently mangled by others.
 */
function integer(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00 && (bytes[start + 1]! & 0x80) === 0) start++;
  const trimmed = bytes.subarray(start);
  const body = trimmed[0]! & 0x80 ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed;
  return tlv(INTEGER, body);
}

/**
 * Build a TimeStampReq over a SHA-256 digest.
 *
 *   TimeStampReq ::= SEQUENCE {
 *     version        INTEGER { v1(1) },
 *     messageImprint MessageImprint,
 *     nonce          INTEGER OPTIONAL,
 *     certReq        BOOLEAN DEFAULT FALSE }
 *
 * `certReq` is TRUE so the authority includes its certificate in the token. That makes the token
 * self-contained: whoever verifies it in five years does not also have to find the right
 * certificate from an authority that may no longer publish it.
 */
export function buildTimestampRequest(sha256: Buffer, nonce: Buffer): Buffer {
  if (sha256.length !== 32) throw new Error("A SHA-256 digest is 32 bytes");

  const algorithm = tlv(SEQUENCE, Buffer.concat([tlv(OID, SHA256_OID), tlv(NULL, Buffer.alloc(0))]));
  const messageImprint = tlv(SEQUENCE, Buffer.concat([algorithm, tlv(OCTET_STRING, sha256)]));

  return tlv(
    SEQUENCE,
    Buffer.concat([
      tlv(INTEGER, Buffer.from([0x01])), // version v1
      messageImprint,
      integer(nonce),
      tlv(BOOLEAN, Buffer.from([0xff])), // certReq TRUE
    ]),
  );
}

// ───────────────────────────── Minimal DER reader ─────────────────────────────

type Tlv = { tag: number; start: number; headerLength: number; length: number; end: number };

/** Read one tag-length-value header at `offset`, or null if the bytes do not form one. */
function readTlv(buf: Buffer, offset: number): Tlv | null {
  if (offset + 2 > buf.length) return null;
  const tag = buf[offset]!;
  const first = buf[offset + 1]!;
  let length: number;
  let headerLength: number;

  if (first < 0x80) {
    length = first;
    headerLength = 2;
  } else {
    const count = first & 0x7f;
    // Indefinite length (0x80) is not valid DER, and anything past four bytes is not a timestamp.
    if (count === 0 || count > 4 || offset + 2 + count > buf.length) return null;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buf[offset + 2 + i]!;
    headerLength = 2 + count;
  }

  const end = offset + headerLength + length;
  if (end > buf.length) return null;
  return { tag, start: offset, headerLength, length, end };
}

export type TimestampResponse =
  | { ok: true; token: Buffer; genTime: Date | null; status: number }
  | { ok: false; error: string; status: number | null };

/** RFC 3161 PKIStatus. 0 and 1 are the two that come with a usable token. */
const STATUS_TEXT: Record<number, string> = {
  0: "granted",
  1: "granted with modifications",
  2: "rejected",
  3: "waiting",
  4: "revocation warning",
  5: "revoked",
};

/**
 * Read a TimeStampResp far enough to know whether it worked and to keep the token.
 *
 *   TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo OPTIONAL }
 *   PKIStatusInfo ::= SEQUENCE { status INTEGER, ... }
 *
 * The token is returned as the RAW DER of the ContentInfo, byte for byte as the authority sent it.
 * That is the artifact; nothing downstream re-encodes it.
 */
export function parseTimestampResponse(der: Buffer): TimestampResponse {
  const outer = readTlv(der, 0);
  if (!outer || outer.tag !== SEQUENCE) return { ok: false, error: "Not a timestamp response", status: null };

  const statusInfo = readTlv(der, outer.start + outer.headerLength);
  if (!statusInfo || statusInfo.tag !== SEQUENCE) {
    return { ok: false, error: "Timestamp response has no status", status: null };
  }

  const statusInt = readTlv(der, statusInfo.start + statusInfo.headerLength);
  if (!statusInt || statusInt.tag !== INTEGER) {
    return { ok: false, error: "Timestamp response has no status code", status: null };
  }
  let status = 0;
  for (let i = 0; i < statusInt.length; i++) {
    status = status * 256 + der[statusInt.start + statusInt.headerLength + i]!;
  }

  if (status !== 0 && status !== 1) {
    return { ok: false, error: `The authority refused: ${STATUS_TEXT[status] ?? `status ${status}`}`, status };
  }

  // The token is whatever follows the status structure, to the end of the outer sequence.
  const tokenStart = statusInfo.end;
  if (tokenStart >= outer.end) {
    return { ok: false, error: "The authority granted the request but returned no token", status };
  }
  const token = der.subarray(tokenStart, outer.end);

  return { ok: true, token: Buffer.from(token), genTime: findGenTime(token), status };
}

/**
 * The time the authority asserts, dug out of the token.
 *
 * ── THIS IS A SCAN, NOT A PARSE, AND THAT IS A DELIBERATE TRADE ─────────────────────────────
 * `genTime` lives inside TSTInfo, inside an OCTET STRING, inside the eContent of a CMS SignedData -
 * reaching it properly means a CMS parser, which is exactly the dependency this file exists to
 * avoid. So instead every GeneralizedTime in the token is read, and the first one that lands within
 * a day of now is taken.
 *
 * What makes that safe: this value is CONVENIENCE ONLY. It is shown on the founder's screen, and
 * nothing is decided by it. The authoritative artifact is the token itself, stored verbatim and
 * verified by `openssl ts -verify` - which does have a real parser. If this returns null the
 * timestamp is still perfectly valid; the screen just says "see the token".
 */
function findGenTime(token: Buffer): Date | null {
  const now = Date.now();
  for (let i = 0; i + 2 < token.length; i++) {
    if (token[i] !== GENERALIZED_TIME) continue;
    const tlvAt = readTlv(token, i);
    if (!tlvAt || tlvAt.length < 14 || tlvAt.length > 24) continue;

    const text = token
      .subarray(tlvAt.start + tlvAt.headerLength, tlvAt.end)
      .toString("latin1");
    const parsed = parseGeneralizedTime(text);
    if (parsed && Math.abs(parsed.getTime() - now) < 86400_000) return parsed;
  }
  return null;
}

/** "20261022091530Z" / "20261022091530.123Z" → Date. UTC only, which is all DER permits. */
export function parseGeneralizedTime(text: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?Z$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, frac] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
    frac ? Number(frac.padEnd(3, "0")) : 0,
  );
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export const TIMESTAMP_CONTENT_TYPE = "application/timestamp-query";
export const TIMESTAMP_REPLY_TYPE = "application/timestamp-reply";
