"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Globe, History, Monitor,
  Image as ImageIcon, Plus, Smartphone, Trash2,
} from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Card, Hint, Pill } from "@/components/ui/kit";
import { Select } from "@/components/ui/form";
import { toast, askConfirm } from "@/components/ui/feedback";
import SitePageRenderer from "@/components/sites/SitePageRenderer";
import MediaPicker, { type PickedImage } from "@/components/sites/MediaPicker";
import { groupedTemplates, templateByKey } from "@/lib/site-templates";
import type { SiteBlock, SiteSectionBlock } from "@/lib/site-types";
import type { PageDetail } from "@/server/sites-metrics";
import { restoreRevision, savePageSections, togglePublishPage, updatePageMeta } from "@/server/sites-actions";

const input =
  "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const area =
  "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

/** Autosave delay. Long enough that typing a paragraph is one save, not forty. */
const AUTOSAVE_MS = 2500;

export default function PageBuilder({ page, canManage }: { page: PageDetail; canManage: boolean }) {
  const router = useRouter();

  const [sections, setSections] = useState<SiteSectionBlock[]>(page.sections);
  const [selected, setSelected] = useState<string | null>(page.sections[0]?.id ?? null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showRevisions, setShowRevisions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Which block the media picker is filling in. Held as a coordinate rather than a callback so the
  // modal keeps working across the re-renders that editing causes.
  const [picking, setPicking] = useState<{ colIdx: number; blockId: string } | null>(null);

  // The last content known to be on the server. Compared against `sections` to decide dirtiness —
  // a boolean flag would go stale the moment a save landed while an edit was in flight.
  const savedRef = useRef(JSON.stringify(page.sections));
  const dirty = JSON.stringify(sections) !== savedRef.current;

  const seedRef = useRef(Date.now() % 100000);
  const nextSeed = () => ++seedRef.current;

  const save = useCallback(async () => {
    if (!canManage) return;
    const snapshot = JSON.stringify(sections);
    if (snapshot === savedRef.current) return;
    setSaving(true);
    const res = await savePageSections(page.id, sections);
    setSaving(false);
    if (!res.ok) return toast(res.error, "error");
    // Stamped from the SNAPSHOT that was sent, not from current state: an edit made while the
    // request was in flight must stay dirty, or it is silently dropped.
    savedRef.current = snapshot;
    setSavedAt(new Date());
  }, [canManage, page.id, sections]);

  // Autosave. GHL shows "Last saved 3:38 PM" and the team will expect the same — but the real
  // reason is that a builder without it loses work to a closed tab, and this content is the
  // public face of the business.
  useEffect(() => {
    if (!dirty || !canManage) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, canManage, save]);

  // Unsaved work must not leave silently. The autosave above covers the common case; this covers
  // the tab closed inside the debounce window.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const active = useMemo(() => sections.find((s) => s.id === selected) ?? null, [sections, selected]);

  function patchSection(id: string, patch: Partial<SiteSectionBlock>) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function moveSection(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addSection(key: string) {
    const t = templateByKey(key);
    if (!t) return;
    const built = t.build(nextSeed());
    setSections((prev) => [...prev, built]);
    setSelected(built.id);
  }
  async function removeSection(id: string) {
    if (!(await askConfirm({ title: "Remove this section?", danger: true }))) return;
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (selected === id) setSelected(null);
  }
  function patchBlock(sectionId: string, colIdx: number, blockId: string, patch: Partial<SiteBlock>) {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sectionId
          ? s
          : {
              ...s,
              columns: s.columns.map((col, ci) =>
                ci !== colIdx ? col : col.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
              ),
            },
      ),
    );
  }

  return (
    <div className="w-full space-y-4">
      <Link
        href={`/sites/${page.siteId}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary"
      >
        <ArrowLeft size={16} /> {page.siteName}
      </Link>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-display-l font-bold text-ink">{page.title}</h1>
          <p className="mt-0.5 flex items-center gap-2 font-mono text-caption text-ink-3">
            <span>{page.path}</span>
            <span aria-live="polite" className="font-sans">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : "Saved"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-field border border-line">
            <IconButton label="Desktop preview" onClick={() => setDevice("desktop")}>
              <Monitor size={15} className={device === "desktop" ? "text-primary" : undefined} />
            </IconButton>
            <IconButton label="Mobile preview" onClick={() => setDevice("mobile")}>
              <Smartphone size={15} className={device === "mobile" ? "text-primary" : undefined} />
            </IconButton>
          </div>
          <Btn variant="ghost" icon={<History size={16} />} onClick={() => setShowRevisions((v) => !v)}>
            History
          </Btn>
          {page.published && (
            <a href={`/s/${page.siteSlug}${page.path === "/" ? "" : page.path}`} target="_blank" rel="noreferrer">
              <Btn variant="ghost" icon={<ExternalLink size={16} />}>View live</Btn>
            </a>
          )}
          {canManage && (
            <>
              <Btn variant="ghost" busy={saving} disabled={!dirty} onClick={() => void save()}>
                Save
              </Btn>
              <Btn
                variant={page.published ? "soft" : "primary"}
                icon={<Globe size={16} />}
                onClick={async () => {
                  // Publishing the state on screen, not the state on the server: publishing while
                  // an edit is still pending would put the previous version live.
                  await save();
                  const res = await togglePublishPage(page.id);
                  if (!res.ok) return toast(res.error, "error");
                  toast(page.published ? "Unpublished" : "Published");
                  router.refresh();
                }}
              >
                {page.published ? "Unpublish" : "Publish"}
              </Btn>
            </>
          )}
        </div>
      </div>

      {showRevisions && (
        <Card title="History" subtitle="Every save is snapshotted — restoring is itself a save, so nothing is lost">
          {page.revisions.length === 0 ? (
            <p className="text-sm text-ink-3">No earlier versions yet.</p>
          ) : (
            <div className="space-y-1">
              {page.revisions.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-field px-2 py-1.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                    {r.createdAt.toLocaleString()}
                    {r.label ? ` · ${r.label}` : ""}
                    {r.authorName ? ` · ${r.authorName}` : ""}
                  </span>
                  <span className="text-caption text-ink-3">{r.sectionCount} sections</span>
                  {canManage && (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (!(await askConfirm({ title: "Restore this version?" }))) return;
                        const res = await restoreRevision(r.id);
                        if (!res.ok) return toast(res.error, "error");
                        toast("Restored");
                        router.refresh();
                      }}
                    >
                      Restore
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
        {/* ── Left: structure + editing ── */}
        <div className="space-y-4">
          <Card title="Sections" flush>
            <div className="space-y-1 p-2">
              {sections.length === 0 && (
                <p className="px-2 py-3 text-sm text-ink-3">Add a section to start building.</p>
              )}
              {sections.map((s, i) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-1 rounded-field px-2 py-1.5 ${
                    s.id === selected ? "bg-primary-soft" : "hover:bg-surface-2"
                  }`}
                >
                  <button
                    onClick={() => setSelected(s.id)}
                    className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${
                      s.id === selected ? "text-primary-strong" : "text-ink-2"
                    }`}
                  >
                    {s.name || "Section"}
                  </button>
                  <IconButton label="Move up" onClick={() => moveSection(i, -1)}><ArrowUp size={13} /></IconButton>
                  <IconButton label="Move down" onClick={() => moveSection(i, 1)}><ArrowDown size={13} /></IconButton>
                  <IconButton label="Remove section" onClick={() => removeSection(s.id)}><Trash2 size={13} /></IconButton>
                </div>
              ))}
            </div>
          </Card>

          {canManage && (
            <Card title="Add a section">
              <div className="space-y-3">
                {groupedTemplates().map((g) => (
                  <div key={g.group}>
                    <p className="mb-1 text-caption font-semibold uppercase text-ink-3">{g.group}</p>
                    <div className="space-y-1">
                      {g.items.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => addSection(t.key)}
                          className="block w-full rounded-field border border-line px-2.5 py-1.5 text-left hover:border-primary hover:bg-surface-2"
                        >
                          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                            <Plus size={12} /> {t.name}
                          </span>
                          <span className="mt-0.5 block text-caption text-ink-3">{t.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {active && canManage && (
            <SectionInspector
              section={active}
              onPatch={(patch) => patchSection(active.id, patch)}
              onPatchBlock={(ci, bid, patch) => patchBlock(active.id, ci, bid, patch)}
              onOpenPicker={(ci, bid) => setPicking({ colIdx: ci, blockId: bid })}
            />
          )}

          {canManage && <PageMetaCard page={page} />}
        </div>

        {/* ── Right: live preview ── */}
        <Card title="Preview" subtitle={device === "mobile" ? "390px viewport" : "full width"} flush>
          <div className="overflow-x-auto bg-surface-2 p-4">
            <div
              className="mx-auto overflow-hidden rounded-card border border-line bg-white"
              style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }}
            >
              {/* The same component the public route renders, so what is on screen is what ships —
                  a preview built from a second implementation is a preview that drifts. */}
              <SitePageRenderer
                sections={sections}
                header={page.header}
                footer={page.footer}
                theme={page.theme}
                nav={page.nav}
                incoming={{}}
                fromPath={page.path}
                siteDomain={page.siteDomain}
              />
            </div>
          </div>
        </Card>
      </div>

      <MediaPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(img: PickedImage) => {
          if (!picking || !active) return;
          const existingAlt = active.columns[picking.colIdx]?.find((x) => x.id === picking.blockId)?.alt;
          // The intrinsic dimensions come across with the URL. That is the whole reason the picker
          // returns an object rather than a string: without them the renderer guesses, and the
          // page shifts under the visitor as each image arrives.
          patchBlock(active.id, picking.colIdx, picking.blockId, {
            url: img.url,
            width: img.width ?? undefined,
            height: img.height ?? undefined,
            // An alt already written for THIS placement wins — it is the more specific description
            // of the two, and swapping the image should not silently discard someone's wording.
            ...(existingAlt ? {} : img.alt ? { alt: img.alt } : {}),
          });
          setPicking(null);
        }}
      />
    </div>
  );
}

/** Edits the selected section: its band styling, and the text of the blocks inside it. */
function SectionInspector({
  section,
  onPatch,
  onPatchBlock,
  onOpenPicker,
}: {
  section: SiteSectionBlock;
  onPatch: (patch: Partial<SiteSectionBlock>) => void;
  onPatchBlock: (colIdx: number, blockId: string, patch: Partial<SiteBlock>) => void;
  onOpenPicker: (colIdx: number, blockId: string) => void;
}) {
  const bg = section.background;
  return (
    <Card title={section.name || "Section"} subtitle="Band styling and content">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-caption font-semibold uppercase text-ink-3">
            Width
            <Select
              size="sm"
              value={section.width}
              onChange={(e) => onPatch({ width: e.target.value as SiteSectionBlock["width"] })}
              options={[
                { value: "full", label: "Full bleed" },
                { value: "contained", label: "Contained" },
              ]}
            />
          </label>
          <label className="text-caption font-semibold uppercase text-ink-3">
            Background
            <Select
              size="sm"
              value={bg.kind}
              onChange={(e) => {
                const kind = e.target.value;
                onPatch({
                  background:
                    kind === "color"
                      ? { kind: "color", color: bg.kind === "color" ? bg.color : "#4949ef" }
                      : kind === "image"
                        ? { kind: "image", url: bg.kind === "image" ? bg.url : "" }
                        : { kind: "none" },
                });
              }}
              options={[
                { value: "none", label: "None" },
                { value: "color", label: "Colour" },
                { value: "image", label: "Image" },
              ]}
            />
          </label>
        </div>

        {bg.kind === "color" && (
          <div className="flex gap-1.5">
            <input
              type="color"
              className="h-9 w-12 rounded-field border border-line bg-surface"
              value={bg.color}
              onChange={(e) => onPatch({ background: { kind: "color", color: e.target.value } })}
            />
            <input
              className={input}
              value={bg.color}
              onChange={(e) => onPatch({ background: { kind: "color", color: e.target.value } })}
            />
          </div>
        )}
        {bg.kind === "image" && (
          <input
            className={input}
            placeholder="Image URL"
            value={bg.url}
            onChange={(e) => onPatch({ background: { kind: "image", url: e.target.value, overlay: bg.overlay } })}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          {(["Top", "Bottom"] as const).map((lbl, idx) => (
            <label key={lbl} className="text-caption font-semibold uppercase text-ink-3">
              Padding {lbl}
              <input
                type="number"
                className={input}
                value={section.padding[idx]}
                onChange={(e) => {
                  const next: [number, number] = [...section.padding];
                  next[idx] = Number(e.target.value) || 0;
                  onPatch({ padding: next });
                }}
              />
            </label>
          ))}
        </div>

        <div className="space-y-3 border-t border-line pt-3">
          {section.columns.map((col, ci) => (
            <div key={ci}>
              {section.columns.length > 1 && (
                <p className="mb-1 text-caption font-semibold uppercase text-ink-3">Column {ci + 1}</p>
              )}
              <div className="space-y-2">
                {col.map((b) => (
                  <BlockFields
                    key={b.id}
                    b={b}
                    onPatch={(p) => onPatchBlock(ci, b.id, p)}
                    onOpenPicker={() => onOpenPicker(ci, b.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function BlockFields({
  b,
  onPatch,
  onOpenPicker,
}: {
  b: SiteBlock;
  onPatch: (patch: Partial<SiteBlock>) => void;
  onOpenPicker: () => void;
}) {
  const label = <p className="mb-1 text-caption font-semibold uppercase text-ink-3">{b.type}</p>;

  switch (b.type) {
    case "heading":
    case "subheading":
    case "text":
      return (
        <div>
          {label}
          <textarea
            className={area}
            rows={b.type === "text" ? 3 : 1}
            value={b.text ?? ""}
            onChange={(e) => onPatch({ text: e.target.value })}
          />
        </div>
      );
    case "bullets":
      return (
        <div>
          {label}
          <textarea
            className={area}
            rows={3}
            placeholder="One item per line"
            value={(b.items ?? []).join("\n")}
            onChange={(e) => onPatch({ items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      );
    case "footerLinks":
      return (
        <div>
          {label}
          <textarea
            className={area}
            rows={3}
            placeholder="Label|/path — one per line"
            value={(b.items ?? []).join("\n")}
            onChange={(e) => onPatch({ items: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      );
    case "button":
      return (
        <div>
          {label}
          <div className="space-y-1.5">
            <input className={input} placeholder="Label" value={b.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} />
            <input className={input} placeholder="Link" value={b.href ?? ""} onChange={(e) => onPatch({ href: e.target.value })} />
            <label className="flex items-center gap-1.5 text-caption text-ink-2">
              <input
                type="checkbox"
                checked={b.forwardParams ?? false}
                onChange={(e) => onPatch({ forwardParams: e.target.checked })}
              />
              Carry utm &amp; click ids to the target
            </label>
          </div>
        </div>
      );
    case "image":
    case "logo":
      return (
        <div>
          {label}
          <div className="space-y-1.5">
            {b.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.url} alt={b.alt ?? ""} className="h-20 w-full rounded-field bg-surface-2 object-contain" />
            )}
            <Btn size="sm" variant="ghost" icon={<ImageIcon size={13} />} onClick={onOpenPicker}>
              {b.url ? "Replace image" : "Choose image"}
            </Btn>
            <input className={input} placeholder="Image URL" value={b.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} />
            <input className={input} placeholder="Alt text" value={b.alt ?? ""} onChange={(e) => onPatch({ alt: e.target.value })} />
            <Hint>
              Picking from the library also records the image&apos;s real dimensions, which is what
              stops the page jumping as it loads. A pasted URL cannot.
            </Hint>
          </div>
        </div>
      );
    case "video":
    case "map":
      return (
        <div>
          {label}
          <input className={input} placeholder="Embed URL" value={b.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} />
        </div>
      );
    case "nav":
      return (
        <div>
          {label}
          <Hint>Edited on the site&apos;s Menu tab — one menu, every page.</Hint>
        </div>
      );
    default:
      return null;
  }
}

/** Title, path and SEO. Separate from the body so a copy edit never risks moving the URL. */
function PageMetaCard({ page }: { page: PageDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [path, setPath] = useState(page.path);
  const [seoTitle, setSeoTitle] = useState(page.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(page.seoDescription ?? "");
  const [noIndex, setNoIndex] = useState(page.noIndex);
  const [busy, setBusy] = useState(false);

  return (
    <Card title="Page details">
      <div className="space-y-2">
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input className={input} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path" />
        <input className={input} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="SEO title" />
        <textarea
          className={area}
          rows={2}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          placeholder="SEO description"
        />
        <label className="flex items-center gap-1.5 text-caption text-ink-2">
          <input type="checkbox" checked={noIndex} onChange={(e) => setNoIndex(e.target.checked)} />
          Keep out of search engines
        </label>
        {path !== page.path && (
          <Pill tone="warn">Changing the path breaks existing links to {page.path}</Pill>
        )}
        <Btn
          size="sm"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            const res = await updatePageMeta(page.id, { title, path, seoTitle, seoDescription, noIndex });
            setBusy(false);
            if (!res.ok) return toast(res.error, "error");
            toast("Details saved");
            router.refresh();
          }}
        >
          Save details
        </Btn>
      </div>
    </Card>
  );
}
