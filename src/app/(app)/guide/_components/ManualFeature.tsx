import Link from "next/link";
import { AlertTriangle, ListChecks, Settings2, Workflow } from "lucide-react";
import type { AppRole } from "@/lib/sections";
import { ROLE_NAMES, type GuideControl, type GuideFeature } from "@/lib/guide/manual-types";
import { MANUAL_SHOTS } from "@/lib/guide/shots.generated";
import { GuidePath } from "./GuidePath";
import { GuideShotFigure } from "./GuideShotFigure";

/**
 * ONE PART OF A SCREEN, explained three ways: how to use it, why it behaves as it does, and where
 * the rule behind it is changed.
 *
 * `canOpen` is the viewer's own access, asked of every link on the card. A telecaller reading the
 * Pipeline manual still learns that the speed-to-lead window is set in the Console - they just
 * see who to ask instead of a button that would bounce them off a permission check.
 */
export function ManualFeature({
  feature,
  canOpen,
}: {
  feature: GuideFeature;
  canOpen: (href: string) => boolean;
}) {
  const captured = feature.shot ? MANUAL_SHOTS[feature.shot.file] : undefined;

  return (
    <section
      id={feature.id}
      aria-labelledby={`${feature.id}-title`}
      className="scroll-mt-24 rounded-card border border-line bg-surface p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h2 id={`${feature.id}-title`} className="font-display text-h3 text-ink">
            {feature.name}
          </h2>
          <GuidePath path={feature.where} />
        </div>
        {feature.href && canOpen(feature.href) && (
          <Link
            href={feature.href}
            className="whitespace-nowrap rounded-field border border-line px-3 py-1 text-sm font-medium text-accent hover:bg-surface-2"
          >
            Open →
          </Link>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-ink-2">{feature.what}</p>

      {feature.shot && captured && (
        <div className="mt-4 max-w-4xl">
          <GuideShotFigure
            size={{ width: captured.width, height: captured.height }}
            shot={{
              src: captured.src,
              caption: feature.shot.caption,
              hotspot:
                captured.hotspot && feature.shot.highlight
                  ? { ...captured.hotspot, label: feature.shot.highlight.label }
                  : undefined,
            }}
          />
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ListChecks size={16} aria-hidden className="text-primary" /> How to use it
          </h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            {feature.use.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Workflow size={16} aria-hidden className="text-primary" /> The logic behind it
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            {feature.logic.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {feature.controls && feature.controls.length > 0 && (
        <div className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Settings2 size={16} aria-hidden className="text-primary" /> Change or reset this rule
          </h3>
          <ul className="mt-2 space-y-3">
            {feature.controls.map((c) => (
              <ControlCard key={`${c.setting}-${c.href}`} control={c} canOpen={canOpen} />
            ))}
          </ul>
        </div>
      )}

      {feature.watchOut && feature.watchOut.length > 0 && (
        <div className="mt-6 rounded-field bg-warn-soft px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-warn">
            <AlertTriangle size={15} aria-hidden /> Watch out
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {feature.watchOut.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function whoCanChange(who: AppRole[]): string {
  return who.map((r) => ROLE_NAMES[r]).join(", ");
}

export function ControlCard({
  control,
  canOpen,
}: {
  control: GuideControl;
  canOpen: (href: string) => boolean;
}) {
  const open = canOpen(control.href);
  return (
    <li className="rounded-field border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="font-medium text-ink">{control.setting}</p>
          <GuidePath path={control.where} />
        </div>
        {open ? (
          <Link
            href={control.href}
            className="whitespace-nowrap rounded-btn bg-primary px-3 py-1.5 text-sm font-semibold text-on-accent hover:bg-primary-strong"
          >
            Open the setting →
          </Link>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-surface px-2.5 py-1 text-caption font-medium text-ink-2">
            Ask: {whoCanChange(control.who)}
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {control.default && (
          <>
            <dt className="font-medium text-ink-3">Default</dt>
            <dd className="text-ink-2">{control.default}</dd>
          </>
        )}
        <dt className="font-medium text-ink-3">Who can change it</dt>
        <dd className="text-ink-2">{whoCanChange(control.who)}</dd>
        <dt className="font-medium text-ink-3">What a change does</dt>
        <dd className="text-ink-2">{control.effect}</dd>
        {control.reset && (
          <>
            <dt className="font-medium text-ink-3">To reset it</dt>
            <dd className="text-ink-2">{control.reset}</dd>
          </>
        )}
      </dl>
    </li>
  );
}
