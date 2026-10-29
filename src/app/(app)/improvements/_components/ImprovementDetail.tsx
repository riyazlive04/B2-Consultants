import Link from "next/link";
import { AlertTriangle, PowerOff, X } from "lucide-react";
import { Card, CardTitle, Panel, Pill } from "@/components/ui/kit";
import { DateText } from "@/components/ui/DateText";
import {
  IMPROVEMENT_KIND_SHORT,
  IMPROVEMENT_SEVERITY_SHORT,
  IMPROVEMENT_STATUS_LABELS,
  answerDisplay,
  questionLabel,
} from "@/lib/improvement";
import type { ImprovementDetail as Detail } from "@/server/improvements";
import { ImprovementTriage } from "./ImprovementTriage";
import { severityTone, statusTone } from "./tone";

/**
 * One report, in full.
 *
 * ── The arming verdict comes FIRST, above the reporter's own words ──────────────────────────
 * That ordering is the whole point of the module. Most engines in this app ship OFF and live has
 * them at that default, so a large share of reports are "this section does nothing" about a
 * screen that is behaving exactly as configured. Putting that line at the top ends those
 * investigations before they start; burying it under three paragraphs of description wastes the
 * one thing here that is automatic.
 */
export function ImprovementDetail({ detail, canTriage }: { detail: Detail; canTriage: boolean }) {
  const ctx = detail.context;

  return (
    <Card
      title={
        <CardTitle icon={<AlertTriangle size={17} />}>
          {detail.ref} · {detail.title}
        </CardTitle>
      }
      subtitle={
        <>
          {IMPROVEMENT_KIND_SHORT[detail.kind]} · reported by {detail.reporterName} ({detail.reporterRole}){" "}
          <DateText date={detail.createdAt} />
        </>
      }
      actions={
        <>
          <Pill tone={severityTone(detail.severity)}>{IMPROVEMENT_SEVERITY_SHORT[detail.severity]}</Pill>
          <Pill tone={statusTone(detail.status)}>{IMPROVEMENT_STATUS_LABELS[detail.status]}</Pill>
          <Link
            href="/improvements"
            title="Close"
            aria-label="Close this report"
            className="grid h-9 w-9 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={16} />
          </Link>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-5">
          {!!ctx?.enginesOff?.length && (
            <div className="rounded-field border border-line bg-warn-soft p-3.5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-warn">
                <PowerOff size={15} /> An engine behind this screen was OFF when this was reported
              </p>
              <ul className="mt-1.5 space-y-1">
                {ctx.enginesOff.map((e) => (
                  <li key={e.key} className="text-caption text-ink-2">
                    <strong className="text-ink">{e.name}</strong> - {e.consequence}{" "}
                    <span className="text-muted">({e.where})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-caption text-muted">
                Check this before anything else. It may be the whole answer.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {Object.entries(detail.answers).map(([id, value]) => (
              <div key={id}>
                <p className="text-label font-semibold uppercase text-ink-3">
                  {questionLabel(detail.kind, id)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">
                  {answerDisplay(detail.kind, id, value)}
                </p>
              </div>
            ))}
            {detail.reporterNote && (
              <div>
                <p className="text-label font-semibold uppercase text-ink-3">Anything else</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{detail.reporterNote}</p>
              </div>
            )}
          </div>

          <Panel>
            <p className="text-label font-semibold uppercase text-ink-3">Where</p>
            <p className="mt-1 break-words font-mono text-caption text-ink-2">{detail.route}</p>
            {detail.sectionKey && <p className="text-caption text-muted">Section: {detail.sectionKey}</p>}
            {detail.elementTag && (
              <p className="mt-1.5 text-caption text-ink-2">
                Pointed at{" "}
                {detail.elementTag.text ? (
                  <strong className="text-ink">&ldquo;{detail.elementTag.text}&rdquo;</strong>
                ) : (
                  <span>{detail.elementTag.role ?? "an element"}</span>
                )}
                {detail.elementTag.heading && <> under {detail.elementTag.heading}</>}
                {detail.elementTag.selector && (
                  <>
                    <br />
                    <span className="break-all font-mono text-[11px] text-muted">
                      {detail.elementTag.selector}
                    </span>
                  </>
                )}
              </p>
            )}
            {detail.screenWidth && (
              <p className="mt-1 text-caption text-muted">
                Window {detail.screenWidth} × {detail.screenHeight}
              </p>
            )}
          </Panel>

          {!!detail.breadcrumbs.length && (
            <Panel>
              <p className="text-label font-semibold uppercase text-ink-3">Just before</p>
              <ol className="mt-1 space-y-0.5">
                {detail.breadcrumbs.map((b, i) => (
                  <li key={i} className="text-caption text-ink-2">
                    <span className="text-muted">{b.at}</span> · {b.kind} · {b.label}
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          {!!detail.events.length && (
            <div>
              <p className="mb-2 text-label font-semibold uppercase text-ink-3">History</p>
              <ol className="space-y-2">
                {detail.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-3">
                    <p className="text-caption text-ink-2">
                      <strong className="text-ink">{e.actorName}</strong>{" "}
                      {e.kind === "STATUS"
                        ? `moved it to ${IMPROVEMENT_STATUS_LABELS[(e.toValue ?? "NEW") as keyof typeof IMPROVEMENT_STATUS_LABELS] ?? e.toValue}`
                        : e.kind === "REKIND"
                          ? `re-filed it as ${e.toValue}`
                          : e.kind === "COMMENT"
                            ? "commented"
                            : e.kind.toLowerCase()}{" "}
                      <span className="text-muted">
                        <DateText date={e.createdAt} />
                      </span>
                      {e.visibleToReporter && (
                        <span className="ml-1.5">
                          <Pill tone="info">reporter sees this</Pill>
                        </span>
                      )}
                    </p>
                    {e.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{e.body}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {canTriage ? (
            <ImprovementTriage
              id={detail.id}
              improvementRef={detail.ref}
              status={detail.status}
              kind={detail.kind}
              devNote={detail.devNote}
            />
          ) : (
            // Reading the queue and working it are different grants, so this is a real state
            // rather than an impossible one - and saying so beats rendering nothing.
            <Panel>
              <p className="text-sm text-ink-2">
                You can read this report. Working it through its states needs the
                &ldquo;Triage improvement reports&rdquo; permission.
              </p>
            </Panel>
          )}

          <Panel>
            <p className="text-label font-semibold uppercase text-ink-3">What the app knew</p>
            <dl className="mt-1.5 space-y-1 text-caption">
              <Row k="Role at the time" v={detail.reporterRole} />
              {ctx?.ist && <Row k="Reported (IST)" v={ctx.ist} />}
              <Row k="Build" v={detail.appVersion ?? ctx?.release ?? "unknown"} />
              {ctx?.environment && <Row k="Environment" v={ctx.environment} />}
              <Row
                k="Developer emailed"
                v={detail.notifiedAt ? "yes - accepted by Resend" : "no"}
              />
              {detail.clientDigest && <Row k="Error digest" v={detail.clientDigest} />}
              {ctx?.capabilities?.length ? (
                <Row k="Permissions held" v={ctx.capabilities.join(", ")} />
              ) : (
                <Row k="Permissions held" v="none beyond their role" />
              )}
              {ctx?.userAgent && <Row k="Browser" v={ctx.userAgent} />}
            </dl>
          </Panel>

          {!!ctx?.delivery?.length && (
            <Panel>
              <p className="text-label font-semibold uppercase text-ink-3">Message delivery</p>
              <ul className="mt-1.5 space-y-1 text-caption text-ink-2">
                {ctx.delivery.map((d) => (
                  <li key={d.job}>
                    <strong className="text-ink">{d.job}</strong> ({d.channel}) - {d.state}, sent{" "}
                    {d.sent24h}, failed {d.failed24h}, skipped {d.skippedConfig24h}
                    {d.silent && " · silent"}
                    {d.lastError && <span className="block text-muted">{d.lastError}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!!ctx?.recentErrors?.length && (
            <Panel>
              <p className="text-label font-semibold uppercase text-ink-3">
                Recent server errors
              </p>
              <ul className="mt-1.5 space-y-1 text-caption text-ink-2">
                {ctx.recentErrors.map((e, i) => (
                  <li key={i}>
                    <span className="text-muted">{e.at}</span> {e.message}
                    {e.where && <span className="text-muted"> ({e.where})</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {detail.duplicateOfRef && (
            <Panel>
              <p className="text-caption text-ink-2">
                Marked a duplicate of{" "}
                <Link
                  href={`/improvements?ref=${detail.duplicateOfRef}`}
                  className="font-semibold text-primary-strong hover:underline"
                >
                  {detail.duplicateOfRef}
                </Link>
              </p>
            </Panel>
          )}
        </div>
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none text-muted">{k}:</dt>
      <dd className="min-w-0 break-words text-ink-2">{v}</dd>
    </div>
  );
}
