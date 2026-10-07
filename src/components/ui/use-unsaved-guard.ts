"use client";

import { useEffect, type RefObject } from "react";

/**
 * WARN BEFORE A HALF-TYPED ENTRY IS THROWN AWAY.
 *
 * ── The problem ───────────────────────────────────────────────────────────────────
 * A finance entry is a lot of typing - amount in two currencies, student, level, payment type,
 * method, and on an instalment plan a due date per instalment. None of it is persisted until the
 * form is submitted, so a stray Ctrl-R, a closed tab or a half-remembered click on the sidebar
 * discarded the lot with nothing asked and nothing recoverable. The forms already guard against a
 * FAILED save losing your typing (see lib/action-guard); this guards the case where the save
 * never happened at all.
 *
 * ── Two different exits, two different prompts ────────────────────────────────────
 * Leaving happens in two ways, and only one of them is ours to dress:
 *
 *   · WITHIN the app - a sidebar link, a card, any <a> - is a client-side route change. It is
 *     fully ours to intercept, so `UnsavedNavGuard` stops it and asks with the app's own dialog
 *     (`askConfirm`). This is the common case by far.
 *
 *   · RELOAD or CLOSING THE TAB fires `beforeunload`, and no browser on earth lets a page style
 *     that prompt or even word it - they all show their own generic "Leave site?" and ignore
 *     whatever text you return. That is a hardening measure against pages that trapped people in
 *     dialogs, not something this app can opt out of. So the native prompt stays as the last net
 *     under the real refresh, and everything we CAN dress is dressed.
 *
 * ── How dirty is decided ──────────────────────────────────────────────────────────
 * By listening for a real edit, not by comparing values. The forms are a mix of native inputs,
 * custom popovers and React-held state, so a field-by-field comparison would need every control
 * to report into one place and would go stale the moment a field was added. An `input`/`change`
 * event, captured, is the one signal every control produces however it is built.
 *
 * Cleared on `reset`, which is what the sections call after a successful save - so the guard
 * lifts when the work is safely recorded, and NOT merely when the form was submitted: a submit
 * that comes back with an error leaves your typing on screen, and that typing is still worth
 * protecting.
 */

/**
 * Every watched form's "am I dirty?" answer.
 *
 * A module-level registry rather than React context because the asker is the shell - mounted in
 * the (app) layout, above every page - and the answerers are forms deep inside whichever page is
 * open. A context spanning that would have to be threaded through every route; the question being
 * asked ("is ANY form on screen dirty") has no per-subtree meaning anyway.
 */
const dirtyChecks = new Set<() => boolean>();

/** True when any form currently on screen has been typed into and not saved. */
export function hasUnsavedWork(): boolean {
  for (const isDirty of dirtyChecks) if (isDirty()) return true;
  return false;
}

/** Every registered form forgets its edits - called once the person has chosen to leave anyway. */
const clearers = new Set<() => void>();
export function clearUnsavedWork(): void {
  for (const clear of clearers) clear();
}

/**
 * @param formRef the form to watch
 * @param enabled false to hold the guard off entirely (a read-only view, say)
 */
export function useUnsavedGuard(
  formRef: RefObject<HTMLFormElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    let dirty = false;

    /**
     * Listeners live on `document`, not on the form node, and read `formRef.current` at event
     * time.
     *
     * These forms carry `key={editing?.id ?? "new"}`, so switching which row is being edited
     * replaces the form's DOM node while the component - and therefore this effect - stays
     * mounted. Binding to the node captured on the first run would leave the listeners on a
     * detached element and the guard silently dead for every row but the first. Reading the ref
     * inside the handler always sees the node that is actually on screen.
     */
    const inForm = (target: EventTarget | null) => {
      const form = formRef.current;
      return !!form && target instanceof Node && form.contains(target);
    };

    const onEdit = (e: Event) => {
      if (inForm(e.target)) dirty = true;
    };
    const onReset = (e: Event) => {
      if (inForm(e.target) || e.target === formRef.current) dirty = false;
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      // Both are required: `preventDefault` is the modern spec, `returnValue` is what older
      // engines still read. Setting only one leaves the prompt not showing in some browsers.
      e.preventDefault();
      e.returnValue = "";
    };

    const isDirty = () => dirty;
    const clear = () => {
      dirty = false;
    };
    dirtyChecks.add(isDirty);
    clearers.add(clear);

    // Captured, so an edit inside a control that stops propagation still registers, and so a
    // `reset` - which does not bubble - is still heard.
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    document.addEventListener("reset", onReset, true);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      dirtyChecks.delete(isDirty);
      clearers.delete(clear);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      document.removeEventListener("reset", onReset, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [formRef, enabled]);
}
