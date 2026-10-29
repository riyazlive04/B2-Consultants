import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECORDER_PREFERENCES,
  RECORDING_KINDS,
  RECORDING_LIMITS,
  RECORDING_MAX_BYTES,
  RECORDING_MAX_SECONDS,
  SCREEN_CAPTURE_OPTIONS,
  clampClipSeconds,
  containerOf,
  formatClipLength,
  isStorableMime,
  parseRecordingKind,
  recordingFilename,
  recordingMime,
  sniffContainer,
} from "../recording";

/**
 * The sniff is the security-relevant half of this module: what it returns decides the
 * `Content-Type` of a response the browser renders on this origin. So the tests that matter most
 * are the ones proving it REFUSES things, not the ones proving it accepts media.
 */

const webm = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const ogg = () => new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
const mp4 = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

test("sniffContainer recognises the three containers a browser records", () => {
  assert.equal(sniffContainer(webm()), "webm");
  assert.equal(sniffContainer(ogg()), "ogg");
  assert.equal(sniffContainer(mp4()), "mp4");
});

test("sniffContainer refuses anything else, including things that claim to be media", () => {
  // The attack this exists to stop: a session holder posting HTML with Content-Type video/webm.
  // If this ever returns non-null for it, that HTML is served inline from this origin.
  assert.equal(sniffContainer(new TextEncoder().encode("<html><script>alert(1)</script>")), null);
  // Real media formats we deliberately do not store - no browser MediaRecorder emits them, and
  // accepting formats nobody asked for only widens what the players have to handle.
  assert.equal(sniffContainer(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0])), null, "mp3");
  assert.equal(sniffContainer(new TextEncoder().encode("RIFF....AVI ")), null, "avi/wav");
  assert.equal(sniffContainer(new Uint8Array([])), null, "empty body");
  assert.equal(sniffContainer(new Uint8Array([0x1a, 0x45])), null, "truncated EBML magic");
  // "ftyp" present but NOT at offset 4 is not an ISO-BMFF file.
  assert.equal(sniffContainer(new TextEncoder().encode("ftypisomxxxx")), null);
});

test("audio and video WebM are indistinguishable by magic, which is why kind is declared", () => {
  // This is the whole reason `recordingMime` takes a kind. If this assertion ever fails, the
  // sniff has started guessing and the comment in recording.ts is wrong.
  assert.equal(sniffContainer(webm()), "webm");
  assert.equal(recordingMime("webm", "AUDIO"), "audio/webm");
  assert.equal(recordingMime("webm", "SCREEN"), "video/webm");
});

test("recordingMime only ever yields a type on the storable whitelist", () => {
  // The security property: a stored type is drawn from this list and never from a request header.
  for (const kind of RECORDING_KINDS) {
    for (const container of ["webm", "mp4", "ogg"] as const) {
      const mime = recordingMime(container, kind);
      if (mime !== null) assert.ok(isStorableMime(mime), `${container}/${kind} -> ${mime}`);
    }
  }
  assert.equal(recordingMime("ogg", "SCREEN"), null, "nothing records screen video into Ogg");
  assert.ok(!isStorableMime("text/html"));
  assert.ok(!isStorableMime("image/svg+xml"));
});

test("containerOf strips the codec suffix a recorder reports and rejects the rest", () => {
  // What Chrome's MediaRecorder actually puts on the blob.
  assert.equal(containerOf("video/webm;codecs=vp9,opus"), "webm");
  assert.equal(containerOf("audio/webm;codecs=opus"), "webm");
  assert.equal(containerOf("VIDEO/WEBM; codecs=vp8"), "webm", "case and spacing");
  assert.equal(containerOf("video/mp4"), "mp4");
  assert.equal(containerOf("text/html"), null);
  assert.equal(containerOf("video/x-matroska"), null);
  assert.equal(containerOf(null), null);
  assert.equal(containerOf(undefined), null);
  assert.equal(containerOf(""), null);
});

test("every recorder preference maps onto a storable type for its own kind", () => {
  // The list the client asks MediaRecorder for and the list the server will store must not
  // drift: asking for a format the upload route then refuses is a feature that fails only in the
  // field, on whichever browser happens to prefer that entry.
  for (const kind of RECORDING_KINDS) {
    for (const pref of RECORDER_PREFERENCES[kind]) {
      const container = containerOf(pref);
      assert.ok(container, `${pref} has no container`);
      const mime = recordingMime(container, kind);
      assert.ok(mime && isStorableMime(mime), `${kind} prefers ${pref}, which is not storable`);
    }
  }
});

test("clampClipSeconds respects the cap of the kind it is given", () => {
  assert.equal(clampClipSeconds(14, "AUDIO"), 14);
  assert.equal(clampClipSeconds("14", "AUDIO"), 14, "a query-string value arrives as a string");
  assert.equal(clampClipSeconds(14.6, "AUDIO"), 15, "rounded, because the column is an Int");
  // A screen recording may legitimately run longer than the audio cap, so the clamp must be
  // per-kind. Clamping both to 120 would silently mislabel every long walkthrough.
  assert.equal(clampClipSeconds(170, "SCREEN"), 170);
  assert.equal(clampClipSeconds(170, "AUDIO"), RECORDING_LIMITS.AUDIO.seconds);
  assert.equal(clampClipSeconds(99999, "SCREEN"), RECORDING_LIMITS.SCREEN.seconds);
  for (const kind of RECORDING_KINDS) {
    assert.equal(clampClipSeconds(-5, kind), 0);
    assert.equal(clampClipSeconds(NaN, kind), 0);
    assert.equal(clampClipSeconds(Infinity, kind), 0);
    assert.equal(clampClipSeconds("not a number", kind), 0);
    assert.equal(clampClipSeconds(null, kind), 0);
    assert.equal(clampClipSeconds(undefined, kind), 0);
  }
});

test("parseRecordingKind accepts only the two real kinds", () => {
  assert.equal(parseRecordingKind("AUDIO"), "AUDIO");
  assert.equal(parseRecordingKind("SCREEN"), "SCREEN");
  assert.equal(parseRecordingKind("audio"), null, "case matters - it is an enum value");
  assert.equal(parseRecordingKind("VIDEO"), null);
  assert.equal(parseRecordingKind(""), null);
  assert.equal(parseRecordingKind(null), null);
  assert.equal(parseRecordingKind(undefined), null);
  assert.equal(parseRecordingKind({}), null);
});

test("formatClipLength reads as a clip length and not a number of seconds", () => {
  assert.equal(formatClipLength(0), "0:00");
  assert.equal(formatClipLength(9), "0:09");
  assert.equal(formatClipLength(60), "1:00");
  assert.equal(formatClipLength(74), "1:14");
  assert.equal(formatClipLength(180), "3:00");
  assert.equal(formatClipLength(-1), "0:00", "never a negative clock");
});

test("recordingFilename cannot carry a path or a quote out of the ref", () => {
  assert.equal(recordingFilename("IMP-0042", "video/webm", "SCREEN"), "IMP-0042-screen.webm");
  assert.equal(recordingFilename("IMP-0042", "audio/webm", "AUDIO"), "IMP-0042-voice.webm");
  assert.equal(recordingFilename("IMP-0042", "audio/mp4", "AUDIO"), "IMP-0042-voice.m4a");
  assert.equal(recordingFilename("IMP-0042", "video/mp4", "SCREEN"), "IMP-0042-screen.mp4");
  // The ref is ours, but this string is interpolated into a Content-Disposition header, so a
  // quote or a slash in it would break out of the filename parameter.
  const nasty = recordingFilename('../../etc/"passwd', "video/webm", "SCREEN");
  assert.ok(!nasty.includes("/"), nasty);
  assert.ok(!nasty.includes('"'), nasty);
  assert.ok(!nasty.includes(".."), nasty);
  assert.equal(recordingFilename("", "audio/webm", "AUDIO"), "improvement-voice.webm");
});

test("the capture is pinned to the current tab", () => {
  // These flags are the entire privacy guard rail: without them a reporter can hand us another
  // application, another tab or their whole desktop, and it lands in a table every triager can
  // play back. Removing one should have to come through this test.
  assert.equal(SCREEN_CAPTURE_OPTIONS.preferCurrentTab, true);
  assert.equal(SCREEN_CAPTURE_OPTIONS.monitorTypeSurfaces, "exclude");
  assert.equal(SCREEN_CAPTURE_OPTIONS.surfaceSwitching, "exclude");
});

test("the caps stay in the range the module's own comments promise", () => {
  // Guards against a well-meaning bump. Both numbers are reasoned about in recording.ts and
  // changing either is a decision, not a tweak.
  assert.equal(RECORDING_LIMITS.AUDIO.seconds, 120);
  assert.equal(RECORDING_LIMITS.AUDIO.bytes, 2_000_000);
  assert.equal(RECORDING_LIMITS.SCREEN.seconds, 180);
  assert.equal(RECORDING_LIMITS.SCREEN.bytes, 25_000_000);
  assert.equal(RECORDING_MAX_BYTES, 25_000_000, "the route reads the largest cap");
  assert.equal(RECORDING_MAX_SECONDS, 180);
  assert.ok(
    RECORDING_LIMITS.AUDIO.bytes > 1_000_000,
    "a recording must be allowed to exceed the 1 MB server-action body limit",
  );
});
