"use client";

import { Activity, AlertTriangle, CheckCircle2, CircleSlash, Clock } from "lucide-react";
import { Card, Hint } from "./kit";

/**
 * Founder Console → Maintenance → System health.
 *
 * The console is full of switches for engines that only run when an external scheduler calls a
 * cron route. Nothing on any screen said whether that was actually happening, so a dead scheduler
 * looked exactly like a quiet week — and every toggle above kept claiming to be "on".
 *
 * Three questions, answered on one card:
 *   1. Is each cron actually being called, and did it succeed?
 *   2. Is error tracking armed, or are we still blind to production errors?
 *   3. What has broken recently in THIS process?
 *
 * Read-only by design. Everything here is diagnosis; the fixes live in env vars and the host's
 * scheduler, not in a form.
 */

export type CronRowView = {
  job: string;
  lastRunAt: string | null;
  lastOkAt: string | null;
  ageMinutes: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  stale: boolean;
  neverRun: boolean;
};

export type ErrorRowView = {
  at: string;
  level: string;
  message: string;
  where: string | null;
  sent: boolean;
};

function ageLabel(mins: number | null): string {
  if (mins === null) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function CronRow({ row }: { row: CronRowView }) {
  // Three distinct states, three distinct fixes. "Never run" means nothing is calling the route
  // at all — a scheduler that was never wired. "Stale" means it used to be called and stopped.
  // "Failing" means it is being called and throwing. Collapsing these into one red dot would
  // hide which of the three you're looking at.
  const state = row.neverRun
    ? "never"
    : row.consecutiveFailures > 0
      ? "failing"
      : row.stale
        ? "stale"
        : "ok";

  const chrome = {
    ok: { Icon: CheckCircle2, cls: "text-good", label: "Healthy" },
    stale: { Icon: Clock, cls: "text-warn", label: "Stale" },
    failing: { Icon: AlertTriangle, cls: "text-bad", label: `Failing ×${row.consecutiveFailures}` },
    never: { Icon: CircleSlash, cls: "text-muted", label: "Never run" },
  }[state];

  const { Icon } = chrome;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <Icon size={15} className={`shrink-0 ${chrome.cls}`} aria-hidden />
      <code className="text-sm font-semibold text-ink">/api/cron/{row.job}</code>
      <span className={`text-xs font-semibold ${chrome.cls}`}>{chrome.label}</span>
      <span className="ml-auto text-xs tabular-nums text-muted">
        last success {ageLabel(row.ageMinutes)}
      </span>
      {row.lastError && (
        <p className="w-full truncate text-xs text-bad" title={row.lastError}>
          {row.lastError}
        </p>
      )}
    </div>
  );
}

export function SystemHealthPanel({
  crons,
  errors,
  errorsLastHour,
  trackingArmed,
  heartbeatArmed,
  environment,
}: {
  crons: CronRowView[];
  errors: ErrorRowView[];
  errorsLastHour: number;
  trackingArmed: boolean;
  heartbeatArmed: boolean;
  environment: string;
}) {
  const unhealthy = crons.filter((c) => c.stale || c.neverRun || c.consecutiveFailures > 0);

  return (
    <div className="space-y-6">
      <Card>
        <h4 className="flex items-center gap-2 text-h3 text-ink">
          <Activity size={16} className="text-primary" aria-hidden />
          Scheduled jobs
        </h4>
        <Hint>
          Every engine in this app runs only when an external scheduler calls its cron route — the
          app has no clock of its own. A job that has <strong>never run</strong> isn&apos;t wired up;
          one that&apos;s <strong>stale</strong> was wired up and stopped.
        </Hint>
        {unhealthy.length > 0 && (
          <p className="mt-3 rounded-field bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
            {unhealthy.length} of {crons.length} jobs {unhealthy.length === 1 ? "isn't" : "aren't"}{" "}
            reporting healthy. Until they are, the settings on this page describe rules that never fire.
          </p>
        )}
        <div className="mt-4">
          {crons.map((c) => (
            <CronRow key={c.job} row={c} />
          ))}
        </div>
      </Card>

      <Card>
        <h4 className="text-h3 text-ink">Error tracking</h4>
        <Hint>
          Errors are always recorded in-process (the list below, last 50, cleared on restart). With{" "}
          <code>SENTRY_DSN</code> set they&apos;re also shipped off-box, which is the only version
          that survives a container restart or tells you about something at 3am.
        </Hint>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-caption text-muted">Off-box reporting</dt>
            <dd className={`text-sm font-semibold ${trackingArmed ? "text-good" : "text-warn"}`}>
              {trackingArmed ? "Armed" : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Uptime heartbeat</dt>
            <dd className={`text-sm font-semibold ${heartbeatArmed ? "text-good" : "text-muted"}`}>
              {heartbeatArmed ? "Armed" : "Off"}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Errors this hour</dt>
            <dd className={`text-sm font-semibold tabular-nums ${errorsLastHour ? "text-bad" : "text-ink"}`}>
              {errorsLastHour}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Environment</dt>
            <dd className="text-sm font-semibold text-ink">{environment}</dd>
          </div>
        </dl>

        <div className="mt-5">
          <h5 className="text-caption font-semibold uppercase tracking-wide text-muted">
            Recent errors in this process
          </h5>
          {errors.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing recorded since the last restart.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {errors.map((e, i) => (
                <li key={`${e.at}-${i}`} className="rounded-field bg-surface-2 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <code className="text-caption font-semibold text-ink-2">{e.where ?? "app"}</code>
                    <span className="text-caption tabular-nums text-muted">
                      {new Date(e.at).toLocaleString()}
                    </span>
                    {!e.sent && trackingArmed && (
                      <span className="text-caption text-muted" title="Rate-limited locally, not shipped">
                        not sent
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 break-words text-xs text-ink-2">{e.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
