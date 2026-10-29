"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Crosshair, Send, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, Select, TextArea, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import {
  ANSWER_MAX,
  IMPROVEMENT_KIND_DEFS,
  IMPROVEMENT_SEVERITY_DEFS,
  answersComplete,
  questionsFor,
  routePattern,
  suggestTitle,
  type ElementTag,
  type ImprovementKind,
  type ImprovementSeverity,
} from "@/lib/improvement";
import { formatClipLength } from "@/lib/recording";
import { submitImprovement } from "@/server/improvement-actions";
import { ReportRecorderBar, ReportRecorderPanel } from "./ReportRecorder";
import { useReportRecorder } from "./useReportRecorder";

/**
 * THE REPORT FORM.
 *
 * ── Kind first, then its own questions ──────────────────────────────────────────────────────
 * The whole design of this form is in `lib/improvement.ts`: pick what kind of problem it is, and
 * the questions change. A single "describe your problem" box produces "doesn't work", and what makes
 * a report actionable is different per kind - a broken screen needs the steps, a wrong number
 * needs the OTHER number, a rule change needs the reason it is wrong.
 *
 * The questions are READ FROM the same table the server validates against, so the form cannot ask
 * for less than the server requires or more than it will store. Two definitions of one contract is
 * how the income form came to accept a blank the server read as a business name.
 *
 * ── What the person does not have to tell us ────────────────────────────────────────────────
 * Which screen they are on, their role, which build is running, whether the engine behind the
 * screen is switched off. The route is taken from `usePathname`; everything else is captured
 * server-side at submit (`server/improvement-context.ts`). Nobody should have to describe where they
 * were standing, and most people cannot describe the rest at all.
 */
export function SuggestImprovementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [kind, setKind] = useState<ImprovementKind | null>(null);
  const [severity, setSeverity] = useState<ImprovementSeverity>("ANNOYING");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState<ElementTag | null>(null);
  /**
   * The recording lives in a hook, not in this component, because the FORM HAS TO HIDE while it
   * runs - see `useReportRecorder`. A self-contained recorder component could not ask its parent
   * to step out of the way.
   */
  const recorder = useReportRecorder();
  const clip = recorder.clip;
  /**
   * The screen they pressed Report ON, pinned when the form opens.
   *
   * `usePathname` follows them, and while a screen recording is running they are expected to
   * navigate - that is the entire point. Reading the route at Send would file the report against
   * wherever they happened to finish, which is usually not the screen they are reporting on.
   */
  const [startedOn, setStartedOn] = useState<string | null>(null);
  /** While true the modal is hidden and the next click on the page is captured, not actioned. */
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const questions = kind ? questionsFor(kind) : [];
  // A recording stands in for the required questions - see `answersComplete`. Somebody who has
  // just talked through the problem should not be held at the form by three empty boxes.
  const complete = kind ? answersComplete(kind, answers, !!clip) : false;

  const reset = useCallback(() => {
    setKind(null);
    setSeverity("ANNOYING");
    setAnswers({});
    setNote("");
    setTitle("");
    setTag(null);
    setStartedOn(null);
    recorder.discard();
    setTagging(false);
    setError(null);
    setShowDetail(false);
  }, [recorder]);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  /**
   * "POINT AT THE PROBLEM."
   *
   * One capture-phase listener. The modal steps out of the way, the next click anywhere on the
   * page is swallowed instead of actioned, and what it landed on is recorded: a CSS path, the
   * visible text, the nearest heading and the box on screen.
   *
   * This is what makes a "that number is wrong" report answerable without a conversation. Two
   * screens in this app disagreeing over one figure is its commonest real bug, and the tag says
   * WHICH of the two the person was reading.
   *
   * Capture phase and `stopPropagation`, so the click never reaches the button or row underneath -
   * tagging a Delete button must not press it.
   */
  useEffect(() => {
    if (!tagging) return;

    /**
     * THE WHOLE POINTER SEQUENCE IS SWALLOWED, not just `pointerdown`.
     *
     * `preventDefault()` on `pointerdown` stops focus and text selection and NOTHING ELSE - the
     * browser still dispatches mousedown, mouseup and then `click`. So tagging a link would have
     * recorded the tag and then navigated away from the screen being reported on, and tagging a
     * Delete button would have pressed it. Every event in the sequence is therefore stopped in
     * the capture phase, and tagging ends on `click` - the LAST of them - so the listeners are
     * still attached when it arrives.
     */
    let hit: Element | null = null;

    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e: Event) => {
      swallow(e);
      if (e.target instanceof Element) hit = e.target;
    };
    const onClick = (e: Event) => {
      swallow(e);
      if (hit) setTag(describeElement(hit));
      setTagging(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagging(false);
    };

    // A tick's delay, so the click that STARTED tagging is not the one that gets captured.
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("mousedown", swallow, true);
      document.addEventListener("mouseup", swallow, true);
      document.addEventListener("dblclick", swallow, true);
      document.addEventListener("contextmenu", swallow, true);
      document.addEventListener("click", onClick, true);
    }, 0);
    document.addEventListener("keydown", onKey, true);
    document.body.style.cursor = "crosshair";

    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("mousedown", swallow, true);
      document.removeEventListener("mouseup", swallow, true);
      document.removeEventListener("dblclick", swallow, true);
      document.removeEventListener("contextmenu", swallow, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
    };
  }, [tagging]);

  useEffect(() => {
    if (open && startedOn === null) setStartedOn(pathname || "/");
  }, [open, pathname, startedOn]);

  const { route, params } = useMemo(
    () => routePattern(startedOn ?? pathname ?? "/"),
    [startedOn, pathname],
  );

  /**
   * The suggested title. Computed here rather than with the other derived values because it needs
   * `route` - and specifically the route PATTERN, never the raw path: a recorded report can carry
   * no words at all, so the fallback becomes the title, and a raw path would put a record id in it.
   */
  const suggested = kind
    ? suggestTitle(
        kind,
        answers,
        clip
          ? `${clip.kind === "SCREEN" ? "screen recording" : "voice note"} on ${route}`
          : undefined,
      )
    : "";

  async function send() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    const res = await safeAction(() =>
      submitImprovement({
        kind,
        severity,
        title: title.trim() || undefined,
        answers,
        note: note.trim() || undefined,
        route,
        routeParams: params,
        elementTag: tag,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        // Declared, so the "blocking" email can say there is a recording waiting. The media
        // itself goes up on its own request a moment from now - see below.
        recordingSeconds: clip?.seconds,
        recordingKind: clip?.kind,
      }),
    );
    if (!res.ok) {
      setBusy(false);
      return setError(res.error ?? "That could not be sent");
    }
    const ref = "ref" in res && typeof res.ref === "string" ? res.ref : null;
    const id = "id" in res && typeof res.id === "string" ? res.id : null;

    /**
     * THE CLIP GOES UP SECOND, AND ITS FAILURE IS NOT THE REPORT'S FAILURE.
     *
     * It cannot ride along in the action: Next caps an action body at 1 MB and a two-minute
     * recording can beat that, so it is posted to a route handler against the id that just came
     * back. By this point the report is saved and the developer has already been notified, so a
     * failed upload must not read as "that could not be sent" - the words are the report and they
     * are safe. The person is told plainly that the audio did not make it and the text did.
     */
    let voiceFailed = false;
    if (clip && id) {
      try {
        const qs = new URLSearchParams({
          kind: clip.kind,
          seconds: String(clip.seconds),
          ...(clip.hasAudio ? {} : { mute: "1" }),
        });
        const up = await fetch(`/api/improvements/${id}/recording?${qs}`, {
          method: "POST",
          headers: { "Content-Type": clip.blob.type || "application/octet-stream" },
          body: clip.blob,
        });
        voiceFailed = !up.ok;
      } catch {
        // Offline, or the tab was closed mid-upload. Same outcome, same message.
        voiceFailed = true;
      }

      /**
       * REFRESH, OR THE CLIP IS INVISIBLE ON THE PAGE BEHIND THIS MODAL.
       *
       * `submitImprovement` revalidates `/improvements` as it writes the row - necessarily BEFORE
       * this upload, which needs the id that action returns. So the queue behind this modal has
       * already been re-rendered for a report that had no audio yet, and it will keep that answer
       * until something asks again. Somebody filing a note from the improvements screen would
       * watch their own recording not appear.
       *
       * The route revalidates server-side for everyone else; this is the one the person who just
       * pressed Send actually sees.
       */
      if (!voiceFailed) router.refresh();
    }

    setBusy(false);
    // The ref, by name. A reference somebody can quote is the difference between "I reported it"
    // and a conversation that can actually be looked up.
    toast(
      voiceFailed
        ? `${ref ?? "Your report"} was sent, but the recording did not upload. Everything you typed is saved.`
        : ref
          ? `Logged as ${ref}. Thank you - we can see exactly where you were.`
          : "Sent. Thank you.",
    );
    close();
  }

  return (
    <>
      {/*
        HIDDEN, NEVER UNMOUNTED, in two situations - unmounting would lose every answer typed.

        `tagging` is the old one: they are pointing at an element.
        `recorder.roaming` is the new one, and it is the whole free-roam feature: while a
        recording runs the form steps aside and the app underneath stays fully interactive, so
        they can navigate, open the broken thing and talk over it. `AppShell` sits in the `(app)`
        layout, so this component survives those navigations and their words are still here when
        they come back.
      */}
      {open && recorder.roaming && (
        <ReportRecorderBar
          kind={recorder.kind}
          elapsed={recorder.elapsed}
          hasAudio={recorder.clip?.hasAudio ?? true}
          starting={recorder.status === "starting"}
          onStop={recorder.stop}
          onCancel={recorder.cancel}
        />
      )}

      <Modal
        open={open && !tagging && !recorder.roaming}
        onClose={close}
        title={kind ? "Suggest an improvement" : "What would make this better?"}
        subtitle={
          kind
            ? clip
              ? "Your recording says it - everything below is optional now."
              : "Only the first questions are needed - or record what happened and skip them."
            : "Pick the closest one. We can re-file it if it turns out to be something else."
        }
        size="md"
      >
        {!kind ? (
          <div className="space-y-2">
            {IMPROVEMENT_KIND_DEFS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => setKind(k.key)}
                className="press block w-full rounded-field border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary-soft"
              >
                <span className="block text-sm font-semibold text-ink">{k.label}</span>
                <span className="mt-0.5 block text-caption text-muted">{k.hint}</span>
              </button>
            ))}
            <p className="pt-1 text-caption text-muted">
              We already know which screen you are on and what is switched on behind it - you do
              not need to describe any of that.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setKind(null)}
              className="text-caption font-semibold text-primary-strong hover:underline"
            >
              ← A different kind of problem
            </button>

            {/* Once a recording is attached NOTHING here is required, and the stars come off to
                say so. A form that still looks mandatory while the Send button is enabled makes
                people fill in boxes they have just been told they can skip. */}
            {questions.map((q) => (
              <Field
                key={q.id}
                label={q.label}
                required={q.required && !clip}
                hint={q.required && !clip ? undefined : "Optional"}
              >
                {q.options ? (
                  <Select
                    options={q.options.map((o) => ({ value: o.value, label: o.label }))}
                    placeholder="Choose one"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => {
                      // Read the value BEFORE handing a closure to setState. React nulls
                      // `currentTarget` as soon as this handler returns, and the updater below
                      // runs later - at render - so reading it in there throws.
                      const value = e.currentTarget.value;
                      setAnswers((a) => ({ ...a, [q.id]: value }));
                    }}
                  />
                ) : q.multiline ? (
                  <TextArea
                    rows={2}
                    maxLength={ANSWER_MAX}
                    placeholder={q.placeholder}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => {
                      // Read the value BEFORE handing a closure to setState. React nulls
                      // `currentTarget` as soon as this handler returns, and the updater below
                      // runs later - at render - so reading it in there throws.
                      const value = e.currentTarget.value;
                      setAnswers((a) => ({ ...a, [q.id]: value }));
                    }}
                  />
                ) : (
                  <TextInput
                    maxLength={ANSWER_MAX}
                    placeholder={q.placeholder}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => {
                      // Read the value BEFORE handing a closure to setState. React nulls
                      // `currentTarget` as soon as this handler returns, and the updater below
                      // runs later - at render - so reading it in there throws.
                      const value = e.currentTarget.value;
                      setAnswers((a) => ({ ...a, [q.id]: value }));
                    }}
                  />
                )}
              </Field>
            ))}

            <Field label="How much is it holding you up?" required>
              <Select
                options={IMPROVEMENT_SEVERITY_DEFS.map((s) => ({ value: s.key, label: s.label }))}
                value={severity}
                onChange={(e) => setSeverity(e.currentTarget.value as ImprovementSeverity)}
              />
            </Field>

            {/* The tag, offered as a plain control rather than a step: most reports do not need it
                and a required extra screen would cost more reports than the tag is worth. */}
            <div className="rounded-field border border-line bg-surface-2 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Point at it (optional)</p>
                  <p className="mt-0.5 text-caption text-muted">
                    {tag
                      ? `Tagged: ${tag.text ? `"${tag.text}"` : tag.role || "an element"}${tag.heading ? ` under ${tag.heading}` : ""}`
                      : "Hide this and click the exact thing that is wrong."}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  {tag && (
                    <button
                      type="button"
                      onClick={() => setTag(null)}
                      title="Remove the tag"
                      className="grid h-9 w-9 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface hover:text-ink"
                    >
                      <X size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setTagging(true)}
                    className="press inline-flex h-9 items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong"
                  >
                    <Crosshair size={14} />
                    {tag ? "Point again" : "Point at it"}
                  </button>
                </div>
              </div>
            </div>

            <Field label="Anything else?" hint="Optional">
              <TextArea
                rows={2}
                maxLength={ANSWER_MAX}
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
            </Field>

            {/* Below the typed questions, not above them: the words are the report, and a
                recorder offered first would invite a three-minute video in place of the three
                answers that make a report actionable. It renders nothing at all on a browser
                that can do neither. */}
            <ReportRecorderPanel
              supportsAudio={recorder.supportsAudio}
              supportsScreen={recorder.supportsScreen}
              status={recorder.status}
              clip={recorder.clip}
              error={recorder.error}
              start={recorder.start}
              discard={recorder.discard}
            />

            <Field label="Title" hint="We have written one for you - change it if you like">
              <TextInput
                value={title || suggested}
                maxLength={160}
                onChange={(e) => setTitle(e.currentTarget.value)}
              />
            </Field>

            {/*
              WHAT WILL BE SENT, in full, before it is sent.
              Two reasons, both load-bearing: somebody who cannot see what is being collected
              under-reports, and this is the only honest place to show that we are taking the
              screen and the element text along with the words.
            */}
            <div className="rounded-field border border-line bg-surface-2 p-3.5">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="text-caption font-semibold text-primary-strong hover:underline"
              >
                {showDetail ? "Hide" : "What gets sent with this?"}
              </button>
              {showDetail && (
                <dl className="mt-2.5 space-y-1 text-caption text-ink-2">
                  <Line k="Screen" v={route} />
                  <Line k="Window" v={`${typeof window === "undefined" ? "?" : window.innerWidth}px wide`} />
                  {tag?.text && <Line k="Tagged text" v={`"${tag.text}"`} />}
                  {clip && (
                    <Line
                      k={clip.kind === "SCREEN" ? "Screen recording" : "Voice note"}
                      v={
                        clip.kind === "SCREEN"
                          ? `${formatClipLength(clip.seconds)} of this browser tab${clip.hasAudio ? " with your voice over it" : " (no sound)"}, which whoever picks this up will watch - everything visible in the tab is in it`
                          : `a ${formatClipLength(clip.seconds)} recording of your voice, which whoever picks this up will listen to`
                      }
                    />
                  )}
                  <Line
                    k="Also attached"
                    v="your name and role, the running version, and whether the engine behind this screen is switched on"
                  />
                  {/* This line used to read "anything you have not typed or pointed at", which a
                      recording makes untrue. The whole value of this panel is that it is accurate. */}
                  <Line
                    k="Not attached"
                    v={
                      clip
                        ? "anything you have not typed, pointed at or recorded"
                        : "anything you have not typed or pointed at"
                    }
                  />
                </dl>
              )}
            </div>

            <FormError message={error} />

            <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={close}
                className="inline-flex h-10 items-center rounded-btn px-3.5 text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={busy || !complete}
                title={complete ? undefined : "Fill in the questions marked with a star, or record what happened"}
                className="inline-flex h-10 flex-none items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-disabled"
              >
                <Send size={15} />
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* The pointing banner. `pointer-events-none`, so it can never be the thing that gets
          tagged - the one element on screen that must not be clickable right now. */}
      {tagging && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex justify-center p-3">
          <p className="rounded-full bg-primary px-4 py-2 text-caption font-semibold text-on-accent shadow-e3">
            Click the thing that is wrong · Esc to cancel
          </p>
        </div>
      )}
    </>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none text-muted">{k}:</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}

/**
 * What the person pointed at, in a form a developer can act on.
 *
 * `text` is capped at 120 characters here as well as in the schema - it is the single most useful
 * field on the tag (it is the figure they were reading) and also the one most likely to carry a
 * student's name, so it is kept to about one cell's worth and never used in a title or an email.
 */
function describeElement(el: Element): ElementTag {
  const box = el.getBoundingClientRect();
  return {
    selector: cssPath(el),
    testId: el.getAttribute("data-testid") ?? undefined,
    text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120) || undefined,
    role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
    heading: nearestHeading(el),
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
  };
}

/** A short, readable path. Six levels is enough to find the element and short enough to read. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 6) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const tag = node.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(" > ").slice(0, 400);
}

/**
 * The nearest heading above the element - the card or panel it sits in.
 *
 * Worth more than the selector on its own: "₹0" means nothing, "₹0 under Income · October" names
 * the panel that is wrong. Walks up looking for a heading inside each ancestor, so it finds the
 * card's title rather than the page's.
 */
function nearestHeading(el: Element): string | undefined {
  let node: Element | null = el;
  while (node && node !== document.body) {
    const heading = node.querySelector("h1, h2, h3, [role='heading']");
    const text = heading?.textContent?.trim().replace(/\s+/g, " ");
    if (text) return text.slice(0, 160);
    node = node.parentElement;
  }
  return undefined;
}
