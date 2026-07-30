/**
 * Page-scroll lock, reference-counted across EVERY overlay in the app.
 *
 * Client-only (touches `document`); import it only from "use client" components.
 *
 * ── WHY ONE SHARED COUNTER ────────────────────────────────────────────────────────────────────
 * The save-and-restore pattern — each overlay stashing `document.body.style.overflow` on open
 * and writing it back on close — is correct for ONE overlay and wrong for two. The second
 * overlay to open saves `"hidden"` as the value to restore, and whichever closes LAST writes
 * `overflow: hidden` back onto a page with no overlay on it. The page is then unscrollable
 * until a full reload, with nothing on screen to explain why.
 *
 * Modal.tsx fixed this for modals with a counter, but the fix only holds if every locker uses
 * the SAME counter. Four other components kept private save/restore copies — the mobile nav
 * drawer, the Ctrl-K palette, askConfirm and the signature pad's full-screen mode — so any
 * cross-pair interleaving (a palette opened over the daily greeting, a confirm over a modal)
 * still stranded the lock. My Desk is where it kept surfacing: the daily greeting and the
 * "new lead just came in" popup open on their own schedule on the one screen a telecaller
 * keeps open all day, so it collects overlay traffic — and the failure depends on close ORDER,
 * which is why it presented as "sometimes My Desk won't scroll" rather than reliably.
 *
 * The counter has no ordering problem: the FIRST lock records the page's real overflow, the
 * LAST release restores it, and any interleaving between is safe. The returned release is
 * idempotent, so a double-invoked cleanup (React StrictMode) can't decrement twice and unlock
 * the page while an overlay is still up.
 *
 * RULE: never write `document.body.style.overflow` anywhere else. If a new surface needs the
 * page held still, it calls this.
 */

let lockCount = 0;
let restoreTo = "";

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    restoreTo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) document.body.style.overflow = restoreTo;
  };
}
