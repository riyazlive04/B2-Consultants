/**
 * Run a server action without letting a dead network take the page down (issue 10).
 *
 * ── What this replaces ────────────────────────────────────────────────────────────
 * Every entry form called its action as a bare `await`. A server action is a `fetch` under the
 * covers, so submitting while offline - or after the session had ended in another tab - rejected
 * that promise, nothing caught it, and React unwound to the route's error boundary: the whole
 * Finance page replaced by "Finance couldn't load", and everything typed into the form gone with
 * it. Nothing had been saved, which was the one mercy, but the twenty fields the person had just
 * filled in were not recoverable.
 *
 * The form is the right place to handle this. It still holds what was typed, so an error
 * rendered INSIDE it costs one more click; an error thrown past it costs the whole entry.
 *
 * ── What about an expired session? ───────────────────────────────────────────────
 * It never reaches here. `requireSession` answers with `redirect("/login")`, which Next turns
 * into a redirect the client router follows by itself; the middleware attaches `?next=` so the
 * person lands back on the page they were on rather than the dashboard (issue 28). The only
 * thing this wrapper does with a redirect is re-throw it untouched.
 */

export type GuardedResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** The text shown for a failure whose cause we cannot name more precisely. */
const GENERIC = "Could not reach the server. Nothing was saved - check your connection and try again.";

/**
 * True for a rejection that means "the browser could not complete the request", as opposed to a
 * server action that ran and returned an error. `fetch` reports every network condition as the
 * same opaque `TypeError`, so the message is all there is to go on - and it differs per browser,
 * which is why several spellings are matched rather than one.
 */
function looksOffline(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = err instanceof Error ? `${err.name} ${err.message}`.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") || // Safari
    msg.includes("err_internet_disconnected")
  );
}

/** True for the shape Next.js uses to carry a redirect out of a server action. */
function isRedirect(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function guardAction<T>(run: () => Promise<T>): Promise<GuardedResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    /**
     * A redirect is not an error - it is the framework asking the browser to go somewhere, and
     * swallowing it would strand the person on a page they are no longer entitled to. Re-thrown
     * so Next handles it exactly as it would have without this wrapper.
     */
    if (isRedirect(err)) throw err;

    if (looksOffline(err)) {
      return {
        ok: false,
        error:
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "You're offline. Nothing was saved - what you typed is still here, so try again once you're back online."
            : GENERIC,
      };
    }

    /**
     * Anything else is a server-side throw: a crash in the action, a 500 from the edge. It gets a
     * sentence, and the form keeps what was typed.
     *
     * ── No session heuristic here, deliberately ─────────────────────────────────────
     * An earlier version sniffed the message for "unauthorized" / "401" / "session" and
     * navigated to /login. That was both unnecessary and unsafe. Unnecessary, because
     * `requireSession` answers an expired session with `redirect("/login")`, which Next turns
     * into a redirect the client router follows on its own - it never reaches this catch.
     * Unsafe, because this wrapper now guards 272 call sites, and any genuine error whose text
     * merely contained the word "session" would have hijacked the page out from under somebody
     * mid-edit. Matching on an error string is not a way to decide whether to navigate.
     */
    return { ok: false, error: GENERIC };
  }
}

/**
 * The same protection as `guardAction`, in the shape the call site already handles.
 *
 * ── Why a second helper ───────────────────────────────────────────────────────────
 * Fifty-two form handlers across the app follow one pattern:
 *
 *     const res = await createThing(form);
 *     if (!res.ok) return setError(res.error);
 *
 * Every one of them had the bug that cost the Finance form its contents (issue 10): a server
 * action is a `fetch`, so submitting while offline - or after the session ended in another tab -
 * rejects, nothing catches it, and React unwinds to the route's error boundary. The page is
 * replaced by its "couldn't load" screen and everything typed is gone. On the PUBLIC booking
 * form that is a lost booking, from a prospect who will not type it all again.
 *
 * `guardAction` fixes it but changes the shape, so adopting it means restructuring each handler.
 * This returns the SAME `{ ok, error }` an action returns, synthesising a failure from a network
 * error - so the existing `if (!res.ok)` branch handles it unchanged, whether that branch calls
 * `setError`, `toast` or anything else. The edit at each site is one line, which is why all
 * fifty-two could be fixed rather than the handful somebody had time to restructure.
 *
 * A redirect is re-thrown, exactly as in `guardAction`: it is the framework navigating, not an
 * error, and swallowing it would strand somebody on a page they are no longer entitled to.
 */
/**
 * The app has two result shapes, both keyed on `ok`: the ledger-ish `ActionResult`
 * (`{ ok: false; error }`) and the messaging ones (`{ ok: boolean; message }`). Rather than pick
 * a side, the synthesised failure carries BOTH fields, so a call site that reads `res.error` and
 * one that reads `res.message` each find what they expect and neither has to be rewritten.
 */
type ActionLike = { ok: boolean };
type SafeFailure = { ok: false; error: string; message: string };

export async function safeAction<T extends ActionLike>(
  run: () => Promise<T>,
): Promise<T | SafeFailure> {
  const guarded = await guardAction(run);
  if (guarded.ok) return guarded.value;
  return { ok: false as const, error: guarded.error, message: guarded.error };
}
