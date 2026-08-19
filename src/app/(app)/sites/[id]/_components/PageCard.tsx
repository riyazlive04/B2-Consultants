"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Eye, EyeOff, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Popover } from "@/components/ui/field-base";
import { Pill } from "@/components/ui/kit";
import PageThumbnail from "@/components/sites/PageThumbnail";
import type { SiteDetail, SitePageRow } from "@/server/sites-metrics";

/**
 * One page of a website, as a card: title, a live thumbnail, and the actions a page has.
 *
 * The thumbnail and the Edit button both open the builder. The kebab menu holds the actions
 * that change state (publish / unpublish / delete) so they cannot be hit by accident while
 * scanning the grid - the delete in particular used to sit as a bare icon on every row.
 */
export default function PageCard({
  site,
  page,
  canManage,
  busy,
  onTogglePublish,
  onDelete,
}: {
  site: Pick<SiteDetail, "id" | "slug" | "domain" | "published" | "theme" | "nav" | "header" | "footer">;
  page: SitePageRow;
  canManage: boolean;
  busy: boolean;
  onTogglePublish: (page: SitePageRow) => void;
  onDelete: (page: SitePageRow) => void;
}) {
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const editHref = `/sites/${site.id}/pages/${page.id}`;
  const liveHref = `/s/${site.slug}${page.path === "/" ? "" : page.path}`;
  const isLive = site.published && page.published;

  const item =
    "flex w-full items-center gap-2 rounded-field px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-2";

  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors hover:border-primary">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{page.title}</p>
          <p className="truncate font-mono text-caption text-ink-3">{page.path}</p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <Pill tone={page.published ? "good" : "neutral"}>{page.published ? "Live" : "Draft"}</Pill>
          {canManage && (
            <>
              <button
                ref={menuBtn}
                type="button"
                aria-label={`Actions for ${page.title}`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="grid h-8 w-8 place-items-center rounded-btn text-ink-3 hover:bg-surface-2 hover:text-ink"
              >
                <MoreVertical size={16} />
              </button>
              <Popover anchorRef={menuBtn} open={open} onClose={() => setOpen(false)} className="w-48">
                <Link href={editHref} className={item} onClick={() => setOpen(false)}>
                  <Pencil size={14} /> Edit page
                </Link>
                <button
                  type="button"
                  className={item}
                  disabled={busy}
                  onClick={() => { setOpen(false); onTogglePublish(page); }}
                >
                  {page.published ? <EyeOff size={14} /> : <Eye size={14} />}
                  {page.published ? "Unpublish" : "Publish"}
                </button>
                <button
                  type="button"
                  className={`${item} text-risk hover:bg-risk-soft`}
                  disabled={busy}
                  onClick={() => { setOpen(false); onDelete(page); }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </Popover>
            </>
          )}
        </div>
      </div>

      {/* The thumbnail is the page itself, scaled - see PageThumbnail. Clicking it edits. */}
      <Link href={editHref} className="mx-4 mt-3 block overflow-hidden rounded-field border border-line" title={`Edit ${page.title}`}>
        <PageThumbnail
          sections={page.sections}
          header={site.header}
          footer={site.footer}
          theme={site.theme}
          nav={site.nav}
          fromPath={page.path}
          siteDomain={site.domain}
        />
      </Link>

      <div className="mt-auto flex items-center justify-between gap-2 px-4 py-3">
        <Link
          href={editHref}
          className="press inline-flex h-9 items-center gap-2 rounded-btn bg-primary px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-primary-strong"
        >
          <Pencil size={14} /> Edit
        </Link>
        <a
          href={liveHref}
          target="_blank"
          rel="noreferrer"
          aria-label={isLive ? "Open the live page" : "Preview the page (not yet live)"}
          title={isLive ? "Open the live page" : "Not live yet - opens the draft route, which only serves published pages"}
          className={`grid h-9 w-9 place-items-center rounded-btn border border-line text-ink-2 hover:bg-surface-2 hover:text-ink ${isLive ? "" : "opacity-50"}`}
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}
