/**
 * Zoom meeting transport - Server-to-Server OAuth.
 *
 * Same keys-off seam as the Claude, email and WATI channels:
 *   - SECRETS in env, read inline, fail-closed when unset:
 *       ZOOM_ENABLED        "true" to arm meeting creation (default off)
 *       ZOOM_ACCOUNT_ID     the Zoom account the S2S app belongs to
 *       ZOOM_CLIENT_ID      S2S app client id
 *       ZOOM_CLIENT_SECRET  S2S app client secret
 *   - NON-SECRET config (which host runs which calendar) lives in AppSetting("zoomConfig"),
 *     because it is a founder decision that must be changeable without a deploy.
 *
 * NOTHING here ever throws into a request path. Every call resolves a result object, so a
 * missing key, an expired app or a network blip degrades to "this booking has no meeting link"
 * - which `zoom-meetings.ts` then heals on the next automation tick - rather than 500-ing the
 * page or, far worse, rolling back a booking that has already been confirmed to the prospect.
 *
 * VERIFIED against the live B2 account on 7 Oct 2026: token 200, create 201, PATCH 204,
 * DELETE 204, GET-after-delete 404.
 */

const TOKEN_URL = "https://zoom.us/oauth/token";
const FALLBACK_API = "https://api.zoom.us";

/**
 * Zoom hands back the cluster this account actually lives on (`api_url`) alongside the token -
 * for B2 that is `https://api-us.zoom.us`, not the generic host. Using the returned value means
 * an account migrated to another cluster keeps working without a code change.
 */
type TokenCache = { token: string; apiUrl: string; expiresAt: number };
let cached: TokenCache | null = null;

export type ZoomRuntime = {
  /** Armed AND fully credentialed - the only state in which anything is sent to Zoom. */
  enabled: boolean;
  /** All three credentials present, regardless of the flag. */
  configured: boolean;
  /** The flag alone. `envEnabled && !configured` is the misconfigured state env.ts refuses to boot on. */
  envEnabled: boolean;
};

export function getZoomRuntime(): ZoomRuntime {
  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  const envEnabled = process.env.ZOOM_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(accountId && clientId && clientSecret);
  return { enabled: envEnabled && configured, configured, envEnabled };
}

/**
 * Mint (or reuse) an account-credentials access token.
 *
 * Zoom's tokens last an hour and there is NO refresh token for this grant - you simply ask
 * again. Cached in module memory with a 5-minute safety margin so a burst of bookings costs one
 * token request rather than one per booking; a cold start or a container restart just mints a
 * new one. Deliberately not persisted: a token in the database is a credential in a backup.
 */
async function getToken(): Promise<{ token: string; apiUrl: string } | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return { token: cached.token, apiUrl: cached.apiUrl };

  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  if (!accountId || !clientId || !clientSecret) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "account_credentials", account_id: accountId }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      api_url?: string;
    };
    if (!res.ok || !data.access_token) return null;

    cached = {
      token: data.access_token,
      apiUrl: data.api_url?.trim() || FALLBACK_API,
      expiresAt: now + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000,
    };
    return { token: cached.token, apiUrl: cached.apiUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Drop the cached token. Called when Zoom rejects it, so the next call mints a fresh one. */
function forgetToken(): void {
  cached = null;
}

type ZoomResponse = { ok: boolean; status: number; data: Record<string, unknown>; error: string | null };

/**
 * One authenticated Zoom API call, with a single retry when the token is rejected.
 *
 * The retry matters: a token cached just before the app's credentials were rotated (or before a
 * clock skew pushed it past expiry) would otherwise fail every call until the process restarted.
 * 401 is the only retried status - a 400 is our bad request and retrying it just doubles the load.
 */
async function zoomFetch(
  path: string,
  init: { method: string; body?: unknown },
  retrying = false,
): Promise<ZoomResponse> {
  const auth = await getToken();
  if (!auth) return { ok: false, status: 0, data: {}, error: "Zoom credentials are missing or rejected" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${auth.apiUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${auth.token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: ctrl.signal,
    });

    if (res.status === 401 && !retrying) {
      forgetToken();
      clearTimeout(t);
      return zoomFetch(path, init, true);
    }

    // PATCH and DELETE answer 204 with an empty body; .json() on that throws.
    const data =
      res.status === 204
        ? {}
        : ((await res.json().catch(() => ({}))) as Record<string, unknown>);

    if (!res.ok) {
      const message = typeof data.message === "string" ? data.message : `Zoom HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: message };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (e) {
    const error =
      e instanceof Error && e.name === "AbortError" ? "Zoom request timed out" : "Zoom request failed";
    return { ok: false, status: 0, data: {}, error };
  } finally {
    clearTimeout(t);
  }
}

export type ZoomMeeting = {
  meetingId: string;
  /** What the prospect clicks. Already carries `?pwd=`, so nobody types a passcode. */
  joinUrl: string;
  /** Host-only; signs whoever opens it straight in AS the host. NEVER send this to a prospect. */
  startUrl: string;
  /** Whose Zoom account it was actually created on, as Zoom resolved it. */
  hostEmail: string | null;
};

function readMeeting(data: Record<string, unknown>): ZoomMeeting | null {
  const meetingId = data.id === undefined || data.id === null ? "" : String(data.id);
  const joinUrl = typeof data.join_url === "string" ? data.join_url : "";
  if (!meetingId || !joinUrl) return null;
  return {
    meetingId,
    joinUrl,
    startUrl: typeof data.start_url === "string" ? data.start_url : "",
    hostEmail: typeof data.host_email === "string" ? data.host_email : null,
  };
}

/**
 * `me` is a legitimate host identifier for a Server-to-Server app - it resolves to the account
 * owner (info@b2consultants.de on this account, verified 7 Oct 2026). So a deployment that has
 * named no per-person hosts still gets working links rather than an error.
 */
export const DEFAULT_HOST = "me";

export type ZoomCallResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Schedule a meeting on `hostEmail`'s calendar.
 *
 * `start_time` is always sent as a UTC instant with a trailing `Z`. This account's default
 * timezone is Europe/Berlin while our slots are IST wall-time, so a naive local string would be
 * read in the wrong zone and silently schedule the call hours away from the time the prospect
 * picked. An explicit `Z` is unambiguous in every timezone either side ever has.
 */
export async function createZoomMeeting(opts: {
  hostEmail?: string | null;
  topic: string;
  startsAt: Date;
  durationMins: number;
  agenda?: string;
}): Promise<ZoomCallResult<ZoomMeeting>> {
  if (!getZoomRuntime().enabled) return { ok: false, error: "Zoom is not armed" };

  const host = opts.hostEmail?.trim() || DEFAULT_HOST;
  const res = await zoomFetch(`/v2/users/${encodeURIComponent(host)}/meetings`, {
    method: "POST",
    body: {
      topic: opts.topic.slice(0, 200),
      type: 2, // a scheduled meeting at a fixed time, not recurring and not instant
      start_time: opts.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: opts.durationMins,
      ...(opts.agenda ? { agenda: opts.agenda.slice(0, 2000) } : {}),
      settings: {
        // The prospect waits until the host admits them: these are 1:1 sales calls, and a
        // join_url that is effectively public must not drop a stranger into a live call.
        waiting_room: true,
        join_before_host: false,
        approval_type: 2, // no registration - one less step between the prospect and the call
      },
    },
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Zoom rejected the meeting" };

  const meeting = readMeeting(res.data);
  return meeting
    ? { ok: true, value: meeting }
    : { ok: false, error: "Zoom accepted the meeting but returned no join link" };
}

/** Move an existing meeting. Returns ok when Zoom has it at the new time. */
export async function updateZoomMeeting(
  meetingId: string,
  opts: { startsAt: Date; durationMins: number; topic?: string },
): Promise<ZoomCallResult<true>> {
  if (!getZoomRuntime().enabled) return { ok: false, error: "Zoom is not armed" };

  const res = await zoomFetch(`/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: {
      start_time: opts.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: opts.durationMins,
      ...(opts.topic ? { topic: opts.topic.slice(0, 200) } : {}),
    },
  });
  return res.ok ? { ok: true, value: true } : { ok: false, error: res.error ?? "Zoom rejected the change" };
}

/**
 * Cancel a meeting. A 404 counts as SUCCESS - the goal is "this meeting is not on the host's
 * calendar", and one deleted by hand in the Zoom UI already satisfies that. Treating it as a
 * failure would leave a dead meeting id on the booking forever, retried on every sweep.
 */
export async function deleteZoomMeeting(meetingId: string): Promise<ZoomCallResult<true>> {
  if (!getZoomRuntime().enabled) return { ok: false, error: "Zoom is not armed" };

  const res = await zoomFetch(`/v2/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
  if (res.ok || res.status === 404) return { ok: true, value: true };
  return { ok: false, error: res.error ?? "Zoom rejected the cancellation" };
}

/** Read one back. Only used by the self-test script and the Console health check. */
export async function getZoomMeeting(meetingId: string): Promise<ZoomCallResult<ZoomMeeting>> {
  if (!getZoomRuntime().enabled) return { ok: false, error: "Zoom is not armed" };

  const res = await zoomFetch(`/v2/meetings/${encodeURIComponent(meetingId)}`, { method: "GET" });
  if (!res.ok) return { ok: false, error: res.error ?? "Zoom rejected the read" };
  const meeting = readMeeting(res.data);
  return meeting ? { ok: true, value: meeting } : { ok: false, error: "Zoom returned no join link" };
}
