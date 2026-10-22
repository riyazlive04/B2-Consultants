"use client";

import { ExternalLink, FileText, Link2, PlayCircle, Wrench, type LucideIcon } from "lucide-react";
import type { ResourceView } from "@/server/resources";
import {
  RESOURCE_KIND_ACTION,
  RESOURCE_KIND_LABELS,
  SCOPE_LABELS,
  hostOf,
  type ResourceKindValue,
} from "@/lib/resources";
import { Pill } from "@/components/ui/kit";

/**
 * A read-only shelf of course material. Used on the student's classroom and dashboard, and
 * inside the staff panels as the thing being managed.
 *
 * Every link opens in a new tab with `rel="noopener noreferrer"`. `noopener` is the one that
 * matters: without it the opened page gets a handle on `window.opener` and can navigate this
 * tab somewhere else, which on a page a student was told to trust is a phishing primitive.
 */

const ICONS: Record<ResourceKindValue, LucideIcon> = {
  DOCUMENT: FileText,
  VIDEO: PlayCircle,
  TEMPLATE: FileText,
  TOOL: Wrench,
  LINK: Link2,
};

export function ResourceRow({
  r,
  showScope = false,
  trailing,
}: {
  r: ResourceView;
  /** Staff view: say which of the three places this hangs off. */
  showScope?: boolean;
  trailing?: React.ReactNode;
}) {
  const Icon = ICONS[r.kind] ?? Link2;
  const host = hostOf(r.url);
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-field px-2 py-2 hover:bg-ink/5">
      <Icon size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink underline-offset-2 hover:underline"
        >
          {r.title}
          <ExternalLink size={12} className="text-muted" aria-hidden />
        </a>
        {r.description && <span className="block text-caption text-muted">{r.description}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-muted">
          <span>{RESOURCE_KIND_LABELS[r.kind]}</span>
          {host && (
            <>
              <span aria-hidden>·</span>
              {/* The host, because "drive.google.com" and a shortener look identical otherwise
                  and the student is being asked to trust a link somebody else posted. */}
              <span>{host}</span>
            </>
          )}
          {showScope && (
            <>
              <span aria-hidden>·</span>
              <span>{SCOPE_LABELS[r.scope]}</span>
            </>
          )}
          {showScope && !r.visibleToStudents && <Pill tone="warn">Hidden from students</Pill>}
        </span>
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1">{trailing}</span>}
    </li>
  );
}

export function ResourceList({
  resources,
  showScope = false,
  emptyText,
  title,
}: {
  resources: ResourceView[];
  showScope?: boolean;
  emptyText?: string;
  title?: string;
}) {
  if (resources.length === 0) {
    return emptyText ? <p className="text-caption text-muted">{emptyText}</p> : null;
  }
  return (
    <div>
      {title && (
        <h4 className="mb-1 text-label font-semibold uppercase text-ink-2">{title}</h4>
      )}
      <ul className="space-y-0.5">
        {resources.map((r) => (
          <ResourceRow key={r.id} r={r} showScope={showScope} />
        ))}
      </ul>
    </div>
  );
}

/** The verb a kind gets on a prominent button - "Watch" a video, "Get a copy" of a template. */
export function resourceAction(kind: ResourceKindValue): string {
  return RESOURCE_KIND_ACTION[kind];
}
