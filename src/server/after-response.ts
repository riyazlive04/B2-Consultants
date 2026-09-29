import "server-only";
import { captureException } from "@/lib/observability";

/**
 * Run work AFTER the caller has been answered, instead of making them wait for it.
 *
 * ── The problem this exists to solve ─────────────────────────────────────────────
 * Every DB round trip from this app costs ~310ms: the container runs in Mumbai and Supabase is
 * in `ap-southeast-1` (Singapore), and `/api/health` - which is one `SELECT 1` plus one settings
 * read - reports `latencyMs` in the 620-680ms band to prove it. `docs/DEPLOYMENT.md` is blunt
 * that no query tuning recovers a cross-region deployment; moving the container to Singapore is
 * the real fix. Until that happens, the only lever left is HOW MANY of those round trips a human
 * has to sit through before the page answers them.
 *
 * A public opt-in submit was sitting through all of them. Capture wrote the lead, then - still
 * inside the request - scored it, sent the intro WhatsApp (a WATI call with a 12s timeout), sent
 * a Resend notification, created an opportunity card, and ran the whole automation engine
 * inline, executing every send step of every matching workflow until one of them hit a WAIT.
 * None of that is anything the person filling in the form is waiting to find out. They are
 * waiting for one word: "Thanks!".
 *
 * ── Why a plain fire-and-forget is correct HERE ──────────────────────────────────
 * Several call sites await outbound sends with the comment "a route handler's response can end
 * the execution context". That is true on serverless, and this app is not serverless: the
 * Dockerfile's only runtime command is `CMD ["node", "server.js"]` (the Next.js standalone
 * server), so the process is long-lived and a promise created during a request keeps running
 * after that request is answered. `void notifyNewOptIn(lead.id)` in `lead-intake.ts` already
 * relies on exactly this.
 *
 * ── What makes it safe to lose ───────────────────────────────────────────────────
 * Deferred work CAN still be lost, in one way: a container restart mid-flight (a deploy). So the
 * rule for what may be passed to this function is that it must be work a cron already re-drives:
 *   - an unsent SOP step stays DUE and `autoSendDue()` picks it up on the next outreach tick
 *   - an enrollment keeps its `nextRunAt` and `runDueWorkflows()` resumes it
 *   - an unscored lead is re-scored from the stored `intakeAnswers` evidence
 * The lead row itself is NEVER deferred. Capture stays awaited and transactional, because a lead
 * that fails to arrive is the one failure this system cannot recover from.
 *
 * Errors are swallowed and reported rather than thrown: nothing is left holding this promise, so
 * an unhandled rejection here would take down the process instead of failing one side effect.
 */

/** In-flight deferred work, so a test (or a shutdown hook) can wait for it to settle. */
const inFlight = new Set<Promise<void>>();

/**
 * Queue `work` to run once the current response is on its way.
 *
 * Returns immediately. `label` names the work in logs and in the error report - it is the only
 * thing that tells you WHICH deferred task failed, since nobody is holding the promise.
 */
export function afterResponse(label: string, work: () => Promise<unknown>): void {
  /**
   * `setImmediate`, not a bare call.
   *
   * Calling `work()` here would run its body synchronously as far as its first `await` - and for
   * a typical task that first `await` IS the expensive thing, so the query would already be on
   * the wire before the caller got control back. On a one-vCPU box that shares its core with two
   * other apps, that is exactly the wrong moment to start competing for it. `setImmediate` puts
   * the work in the check phase, after the current I/O event has been serviced, so the response
   * is on its way out before any of this begins.
   *
   * The promise is registered NOW rather than when the work starts, so a `flushAfterResponse`
   * that lands in between still waits for it.
   */
  let settle!: () => void;
  const task = new Promise<void>((resolve) => {
    settle = resolve;
  });
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));

  setImmediate(() => {
    void (async () => {
      try {
        await work();
      } catch (err) {
        // Deferred failures are invisible by construction: no caller, no response, no stack in a
        // user's face. Reporting them is the only reason they are ever noticed.
        console.error(`[after-response] ${label} failed`, err);
        await captureException(err, { where: `after-response:${label}` }).catch(() => {});
      } finally {
        settle();
      }
    })();
  });
}

/**
 * Wait for everything currently deferred to settle.
 *
 * For tests and for a graceful-shutdown hook. Deliberately NOT called from request paths - the
 * whole point of `afterResponse` is that a request does not wait.
 */
export async function flushAfterResponse(): Promise<void> {
  while (inFlight.size) {
    await Promise.allSettled([...inFlight]);
  }
}

/** How many deferred tasks are still running. Diagnostics only. */
export function pendingAfterResponse(): number {
  return inFlight.size;
}
