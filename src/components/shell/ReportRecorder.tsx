"use client";

import { Mic, MicOff, MonitorPlay, Square, X } from "lucide-react";
import { RECORDING_LIMITS, formatClipLength } from "@/lib/recording";
import type { ReportClip, RecorderStatus } from "./useReportRecorder";
import type { RecordingKind } from "@/lib/recording";

type Props = {
  supportsAudio: boolean;
  supportsScreen: boolean;
  status: RecorderStatus;
  clip: ReportClip | null;
  error: string | null;
  start: (kind: RecordingKind) => void;
  discard: () => void;
};

/**
 * THE RECORDER PANEL, inside the report form.
 *
 * Two offers, deliberately in this order. "Record my screen" is the stronger report - it shows
 * the clicks and the error appearing, not just a description of them - but "Just my voice" is
 * first because it works on every device including the phones most students file from, and
 * because a person who only wants to say one sentence should not have to refuse a screen share
 * to do it.
 *
 * Renders nothing at all when the browser can do neither. Same fail-closed shape as the WATI and
 * storage seams: a control that cannot do its job should not be on the screen, and the report
 * form is complete without it.
 */
export function ReportRecorderPanel({
  supportsAudio,
  supportsScreen,
  status,
  clip,
  error,
  start,
  discard,
}: Props) {
  if (!supportsAudio && !supportsScreen) return null;

  const busy = status === "starting";

  return (
    <div className="rounded-field border border-line bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Show us instead (optional)</p>
          <p className="mt-0.5 text-caption text-muted">
            {clip
              ? `Attached - ${clip.kind === "SCREEN" ? "screen recording" : "voice note"}, ${formatClipLength(clip.seconds)}${clip.hasAudio ? "" : " (no sound)"}.`
              : supportsScreen
                ? "Record your screen while you walk through it. The form gets out of the way."
                : "Say it out loud instead of typing it."}
          </p>
        </div>

        <div className="flex flex-none items-center gap-2">
          {clip && (
            <button
              type="button"
              onClick={discard}
              title="Remove the recording"
              aria-label="Remove the recording"
              className="grid h-9 w-9 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
          {supportsAudio && (
            <button
              type="button"
              disabled={busy}
              onClick={() => start("AUDIO")}
              className="press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-60"
            >
              <Mic size={14} />
              {clip?.kind === "AUDIO" ? "Again" : "Just my voice"}
            </button>
          )}
          {supportsScreen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => start("SCREEN")}
              className="press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-60"
            >
              <MonitorPlay size={14} />
              {clip?.kind === "SCREEN" ? "Again" : "Record my screen"}
            </button>
          )}
        </div>
      </div>

      {/* The preview is what makes this safe to send: nobody should attach a recording they have
          not watched. `key` on the URL so a re-record reloads the element rather than leaving the
          old clip's buffer in place. */}
      {clip &&
        (clip.kind === "SCREEN" ? (
          <video
            key={clip.url}
            controls
            src={clip.url}
            className="mt-3 max-h-64 w-full rounded-field border border-line bg-black"
          />
        ) : (
          <audio key={clip.url} controls src={clip.url} className="mt-3 h-9 w-full" />
        ))}

      {supportsScreen && !clip && status === "idle" && (
        <p className="mt-2 text-caption text-muted">
          Only this browser tab is captured - never another window or your whole screen.
        </p>
      )}

      {error && <p className="mt-2 text-caption text-bad">{error}</p>}
    </div>
  );
}

/**
 * THE FLOATING BAR, shown while the form is hidden.
 *
 * This is the whole free-roam feature. The form steps aside, the app underneath stays fully
 * interactive - no overlay, no backdrop, nothing swallowing clicks - and this bar is the only
 * thing on screen, so the person can navigate, open the broken thing and talk over it. Their
 * typed answers are still sitting in the hidden form.
 *
 * Bottom-centre, above everything (`z-[120]` clears the shared Popover at 96 and Modal at 90),
 * and `pointer-events-none` on the wrapper so even the bar's own padding cannot block a click on
 * the app behind it.
 */
export function ReportRecorderBar({
  kind,
  elapsed,
  hasAudio,
  starting,
  onStop,
  onCancel,
}: {
  kind: RecordingKind;
  elapsed: number;
  hasAudio: boolean;
  starting: boolean;
  onStop: () => void;
  onCancel: () => void;
}) {
  const cap = RECORDING_LIMITS[kind].seconds;
  const left = Math.max(0, cap - elapsed);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface px-4 py-2.5 shadow-card"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-bad" />
          {starting ? "Starting…" : kind === "SCREEN" ? "Recording screen" : "Recording"}
        </span>

        <span className="font-mono text-caption tabular-nums text-ink-2">
          {formatClipLength(elapsed)}
          {/* The countdown only appears near the end. A timer ticking towards a limit from the
              first second makes people rush; one appearing at thirty seconds left is a warning. */}
          {left <= 30 && <span className="text-bad"> · {left}s left</span>}
        </span>

        {kind === "SCREEN" && !hasAudio && (
          <span title="No microphone - this is a silent recording" className="text-ink-3">
            <MicOff size={15} />
          </span>
        )}

        <span className="hidden text-caption text-muted sm:inline">
          Carry on using the app - show us the problem.
        </span>

        <button
          type="button"
          onClick={onStop}
          disabled={starting}
          className="press inline-flex h-8 items-center gap-1.5 rounded-btn bg-primary px-3 text-caption font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:opacity-60"
        >
          <Square size={12} /> Stop
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Throw this recording away"
          aria-label="Throw this recording away"
          className="grid h-8 w-8 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
