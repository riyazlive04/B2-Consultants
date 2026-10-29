"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RECORDER_PREFERENCES,
  RECORDING_LIMITS,
  SCREEN_BITRATES,
  SCREEN_CAPTURE_OPTIONS,
  SCREEN_VIDEO_CONSTRAINTS,
  type RecordingKind,
} from "@/lib/recording";

export type ReportClip = {
  blob: Blob;
  seconds: number;
  kind: RecordingKind;
  /** False when a SCREEN capture ran without a microphone - declined, or no device. */
  hasAudio: boolean;
  /** Object URL for the preview player. Owned by this hook; revoked when replaced. */
  url: string;
};

export type RecorderStatus = "idle" | "starting" | "recording" | "ready";

/**
 * RECORDING FOR THE IMPROVEMENT REPORT FORM - voice, or the screen with voice over it.
 *
 * ── WHY A HOOK AND NOT A SELF-CONTAINED COMPONENT ──────────────────────────────────────────
 * Because the form has to GET OUT OF THE WAY while this runs. The whole point of a screen
 * recording is that the person walks through the problem - navigates, opens the thing, triggers
 * the error - and a modal sitting over the app makes that impossible. So the parent needs to read
 * `status` to decide whether to hide itself, and a component that owns its own state privately
 * cannot tell it that.
 *
 * The form is HIDDEN, never unmounted, exactly as it already is while somebody is pointing at an
 * element: unmounting would lose every answer they have typed. `AppShell` lives in the `(app)`
 * layout, so it survives navigation too - they can record across three screens and come back to
 * a form still holding their words.
 *
 * ── WHAT IS CAPTURED ───────────────────────────────────────────────────────────────────────
 * The current browser tab only, pinned by `SCREEN_CAPTURE_OPTIONS`. Not another window, not the
 * whole desktop. These files land in a table every triager can play back, and somebody
 * concentrating on reproducing a bug is not also auditing what else is on their screen.
 *
 * The microphone is captured as a SEPARATE stream and merged in, because `getDisplayMedia`'s own
 * `audio` is tab audio - the app's sounds - and not the person talking. If the mic is refused,
 * the screen is still recorded: a silent walkthrough beats nothing, and `hasAudio` tells triage
 * not to sit waiting for a voice.
 */
export function useReportRecorder() {
  const [supportsAudio, setSupportsAudio] = useState(false);
  const [supportsScreen, setSupportsScreen] = useState(false);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [kind, setKind] = useState<RecordingKind>("AUDIO");
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<ReportClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  /** Set when the person cancels, so `onstop` throws the bytes away instead of offering them. */
  const abandonedRef = useRef(false);
  const hasAudioRef = useRef(true);

  /**
   * Feature detection in an effect, not at render: `navigator` does not exist during the server
   * render, and `isSecureContext` is the check that stops any of this appearing on a plain-http
   * origin where the APIs are simply absent.
   *
   * `getDisplayMedia` is missing on iOS entirely - every iPhone and iPad - so the screen option
   * disappears there while the voice note stays. That is the whole reason both kinds exist.
   */
  useEffect(() => {
    const secure = typeof window !== "undefined" && window.isSecureContext;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const canRecord = secure && typeof window.MediaRecorder !== "undefined";
    setSupportsAudio(!!(canRecord && md?.getUserMedia));
    setSupportsScreen(!!(canRecord && md?.getDisplayMedia));
  }, []);

  /**
   * RELEASE EVERY DEVICE. Every exit path runs this.
   *
   * A `MediaStream` left open keeps the browser's recording indicator lit - and for a screen
   * capture, Chrome's "you are sharing this tab" bar stays on screen until the track is stopped.
   * Someone who records one walkthrough and carries on working would have that bar for the rest
   * of the day and would be entirely right to conclude the app is still watching. Stopping the
   * recorder is NOT enough; the tracks are what hold the devices.
   */
  const release = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    for (const s of streamsRef.current) s.getTracks().forEach((t) => t.stop());
    streamsRef.current = [];
    recorderRef.current = null;
  }, []);

  useEffect(
    () => () => {
      release();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [release],
  );

  const discard = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setClip(null);
    setElapsed(0);
    setStatus("idle");
  }, []);

  const stop = useCallback(() => {
    // `stop()` fires `onstop`, which assembles the blob. Devices are released there, not here:
    // the recorder still needs its streams until the last chunk is flushed.
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  /** Throw the recording away mid-flight. Used by the floating bar's Cancel. */
  const cancel = useCallback(() => {
    abandonedRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      release();
      setStatus("idle");
      setElapsed(0);
    }
  }, [release]);

  const start = useCallback(
    async (want: RecordingKind) => {
      setError(null);
      discard();
      abandonedRef.current = false;
      hasAudioRef.current = true;
      setKind(want);
      setStatus("starting");

      const streams: MediaStream[] = [];
      let tracks: MediaStreamTrack[] = [];

      try {
        if (want === "SCREEN") {
          /**
           * The picker appears here and CANNOT be suppressed - the browser insists a human
           * chooses what is shared, every time. `SCREEN_CAPTURE_OPTIONS` narrows that choice to
           * this tab; it does not remove it.
           */
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: SCREEN_VIDEO_CONSTRAINTS,
            audio: false,
            ...SCREEN_CAPTURE_OPTIONS,
          } as MediaStreamConstraints);
          streams.push(display);
          tracks = [...display.getVideoTracks()];

          /**
           * The mic is a SEPARATE ask, and a refusal is not fatal.
           *
           * Two prompts in a row is unavoidable: the screen picker and the microphone are
           * different permissions. If the second is declined we keep the first - a silent
           * walkthrough still shows what happened - and record that fact so triage is not left
           * waiting for a voice that never comes.
           */
          try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            streams.push(mic);
            tracks = [...tracks, ...mic.getAudioTracks()];
          } catch {
            hasAudioRef.current = false;
          }

          /**
           * Chrome puts its own "Stop sharing" button on the screen. If they use THAT instead of
           * ours, the video track ends and the recording must finish cleanly rather than running
           * on against a dead track.
           */
          display.getVideoTracks()[0]?.addEventListener("ended", () => stop());
        } else {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          streams.push(mic);
          tracks = [...mic.getAudioTracks()];
        }
      } catch (e) {
        for (const s of streams) s.getTracks().forEach((t) => t.stop());
        const name = (e as { name?: string })?.name;
        /**
         * The refusals that actually happen, named separately because they need completely
         * different actions from the person reading them. A single "could not record" would send
         * somebody hunting through browser settings for a microphone they have not plugged in.
         *
         * `NotAllowedError` covers both "they pressed Cancel on the picker" and "the browser
         * refused", which are indistinguishable by design - the API will not tell a page whether
         * a human declined, precisely so a page cannot nag.
         */
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? want === "SCREEN"
              ? "Screen sharing was not allowed. Choose this tab when the browser asks."
              : "The browser blocked the microphone. Allow it for this site and try again."
            : name === "NotFoundError" || name === "DevicesNotFoundError"
              ? "No microphone found on this device."
              : want === "SCREEN"
                ? "The screen could not be captured."
                : "The microphone could not be started.",
        );
        setStatus("idle");
        return;
      }

      streamsRef.current = streams;
      const stream = new MediaStream(tracks);

      const mimeType = RECORDER_PREFERENCES[want].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        ...(want === "SCREEN" ? SCREEN_BITRATES : {}),
      });
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        /**
         * THE LENGTH IS MEASURED FROM THE CLOCK - never from `media.duration`.
         *
         * A WebM blob produced by `MediaRecorder` carries no duration in its header, so a player
         * reports `Infinity` for it until the stream has been seeked to the end. That is a
         * well-known trap and every workaround is worse than the obvious thing: note when
         * recording started and subtract.
         */
        const seconds = Math.min(
          RECORDING_LIMITS[want].seconds,
          Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
        );
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        chunksRef.current = [];
        release();

        if (abandonedRef.current) {
          abandonedRef.current = false;
          setStatus("idle");
          setElapsed(0);
          return;
        }

        // Refused here as well as on the server, so an over-long capture fails with an
        // explanation in front of the person instead of a 413 after they press Send.
        if (blob.size > RECORDING_LIMITS[want].bytes) {
          setError("That recording is too big to attach. Try a shorter one.");
          setStatus("idle");
          return;
        }

        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setClip({ blob, seconds, kind: want, hasAudio: hasAudioRef.current, url });
        setElapsed(seconds);
        setStatus("ready");
      };

      startedAtRef.current = Date.now();
      recorder.start();
      setStatus("recording");
      setElapsed(0);

      /**
       * ONE TIMER DRIVES BOTH the counter and the hard stop.
       *
       * Stopping itself at the cap matters more than it looks: letting somebody record for ten
       * minutes and then refusing the upload throws away the only thing they were willing to give
       * us. The cap is enforced by ending the recording, not by rejecting it afterwards.
       */
      tickRef.current = window.setInterval(() => {
        const secs = Math.round((Date.now() - startedAtRef.current) / 1000);
        setElapsed(secs);
        if (secs >= RECORDING_LIMITS[want].seconds) stop();
      }, 250);
    },
    [discard, release, stop],
  );

  return {
    supportsAudio,
    supportsScreen,
    status,
    kind,
    elapsed,
    clip,
    error,
    start,
    stop,
    cancel,
    discard,
    /** True while the form must hide itself so the person can use the app underneath. */
    roaming: status === "recording" || status === "starting",
  };
}
