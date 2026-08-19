"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Globe, History, Monitor,
  MousePointerClick, Plus, Smartphone, Trash2,
} from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Card, Pill } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import SitePageRenderer, { type EditorSelection } from "@/components/sites/SitePageRenderer";
import MediaPicker, { type PickedImage } from "@/components/sites/MediaPicker";
import { groupedTemplates, templateByKey } from "@/lib/site-templates";
import type { SiteBlock, SiteBlockType, SiteSectionBlock } from "@/lib/site-types";
import type { PageDetail } from "@/server/sites-metrics";
import { restoreRevision, savePageSections, togglePublishPage, updatePageMeta } from "@/server/sites-actions";
import { BlockInspector, SectionInspector } from "./Inspector";

const input =
  "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const area =
  "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

/** Autosave delay. Long enough that typing a paragraph is one save, not forty. */
const AUTOSAVE_MS = 2500;

/** Starting content for an element added by hand, so it is visible (and clickable) immediately. */
function blankBlock(type: SiteBlockType, id: string): SiteBlock {
  switch (type) {
    case "heading": return { id, type, text: "New heading", align: "center" };
    case "subheading": return { id, type, text: "New sub heading", align: "center" };
    case "text": return { id, type, text: "New paragraph. Click to edit this text in the panel on the right." };
    case "button": return { id, type, label: "Click here", href: "#", align: "center" };
    case "bullets": return { id, type, items: ["First point", "Second point", "Third point"] };
    case "spacer": return { id, type, size: 32 };
    case "image": return { id, type, url: "", alt: "", align: "center" };
    default: return { id, type };
  }
}

export default function PageBuilder({ page, canManage }: { page: PageDetail; canManage: boolean }) {
  const router = useRouter();

  const [sections, setSections] = useState<SiteSectionBlock[]>(page.sections);
  const [sel, setSel] = useState<EditorSelection | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showRevisions, setShowRevisions] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Which block the media picker is filling in. Held as a coordinate rather than a callback so the
  // modal keeps working across the re-renders that editing causes.
  const [picking, setPicking] = useState<{ sectionId: string; colIdx: number; blockId: string } | null>(null);

  // The last content known to be on the server. Compared against `sections` to decide dirtiness -
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

  // Autosave. GHL shows "Last saved 3:38 PM" and the team will expect the same - but the real
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

  // Escape clears the selection - the same gesture every design tool uses to "click away".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeSection = useMemo(() => sections.find((s) => s.id === sel?.sectionId) ?? null, [sections, sel]);
  const activeBlock = useMemo(() => {
    if (!activeSection || sel?.colIdx === undefined || !sel.blockId) return null;
    return activeSection.columns[sel.colIdx]?.find((b) => b.id === sel.blockId) ?? null;
  }, [activeSection, sel]);

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
    setSel({ sectionId: built.id });
    setShowLibrary(false);
  }
  async function removeSection(id: string) {
    if (!(await askConfirm({ title: "Remove this section?", danger: true }))) return;
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (sel?.sectionId === id) setSel(null);
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
  function addBlock(sectionId: string, colIdx: number, type: SiteBlockType) {
    const id = `b${nextSeed()}`;
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, columns: s.columns.map((col, ci) => (ci !== colIdx ? col : [...col, blankBlock(type, id)])) },
      ),
    );
    setSel({ sectionId, colIdx, blockId: id });
  }
  async function removeBlock(sectionId: string, colIdx: number, blockId: string) {
    if (!(await askConfirm({ title: "Remove this element?", danger: true }))) return;
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sectionId
          ? s
          : { ...s, columns: s.columns.map((col, ci) => (ci !== colIdx ? col : col.filter((b) => b.id !== blockId))) },
      ),
    );
    setSel({ sectionId });
  }

  const inspectorOpen = canManage && !!activeSection;

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
        <Card title="History" subtitle="Every save is snapshotted - restoring is itself a save, so nothing is lost">
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

      {/* ── Workspace: structure | canvas | inspector ──
          The inspector column only exists while something is selected, so the canvas gets the
          room back the moment the author clicks away. */}
      <div
        className={`grid grid-cols-1 gap-4 ${
          inspectorOpen ? "xl:grid-cols-[240px_minmax(0,1fr)_340px]" : "xl:grid-cols-[240px_minmax(0,1fr)]"
        }`}
      >
        {/* ── Left: structure ── */}
        <div className="space-y-4">
          <Card title="Sections" flush>
            <div className="space-y-1 p-2">
              {sections.length === 0 && (
                <p className="px-2 py-3 text-sm text-ink-3">Add a section to start building.</p>
              )}
              {sections.map((s, i) => {
                const on = s.id === sel?.sectionId;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-0.5 rounded-field px-1.5 py-1 ${on ? "bg-primary-soft" : "hover:bg-surface-2"}`}
                  >
                    <button
                      onClick={() => setSel({ sectionId: s.id })}
                      className={`min-w-0 flex-1 truncate text-left text-sm font-medium ${on ? "text-primary-strong" : "text-ink-2"}`}
                    >
                      {s.name || "Section"}
                    </button>
                    <IconButton size="sm" label="Move up" onClick={() => moveSection(i, -1)}><ArrowUp size={13} /></IconButton>
                    <IconButton size="sm" label="Move down" onClick={() => moveSection(i, 1)}><ArrowDown size={13} /></IconButton>
                    <IconButton size="sm" label="Remove section" onClick={() => removeSection(s.id)}><Trash2 size={13} /></IconButton>
                  </div>
                );
              })}
            </div>
            {canManage && (
              <div className="border-t border-line p-2">
                <Btn size="sm" variant={showLibrary ? "soft" : "outline"} icon={<Plus size={14} />} onClick={() => setShowLibrary((v) => !v)} className="w-full">
                  Add a section
                </Btn>
              </div>
            )}
          </Card>

          {canManage && showLibrary && (
            <Card title="Section library" flush>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
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

          {canManage && <PageMetaCard page={page} />}
        </div>

        {/* ── Centre: the canvas ── */}
        <Card
          title="Canvas"
          subtitle={
            canManage
              ? device === "mobile" ? "390px viewport · click any element to edit it" : "Click any element to edit it"
              : device === "mobile" ? "390px viewport" : "full width"
          }
          flush
        >
          <div className="overflow-x-auto bg-surface-2 p-4" onClick={() => setSel(null)}>
            <div
              className="mx-auto overflow-hidden rounded-card border border-line bg-white"
              style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* The same component the public route renders, so what is on screen is what ships -
                  a preview built from a second implementation is a preview that drifts. Edit mode
                  adds the click targets and the selection ring; nothing else differs. */}
              <SitePageRenderer
                sections={sections}
                header={page.header}
                footer={page.footer}
                theme={page.theme}
                nav={page.nav}
                incoming={{}}
                fromPath={page.path}
                siteDomain={page.siteDomain}
                edit={canManage ? { selected: sel, onSelect: setSel } : undefined}
              />
            </div>
          </div>
        </Card>

        {/* ── Right: the inspector ── */}
        {inspectorOpen && activeSection && (
          <Card flush className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-hidden">
            {activeBlock && sel?.colIdx !== undefined && sel.blockId ? (
              <BlockInspector
                key={activeBlock.id}
                block={activeBlock}
                themePrimary={page.theme.primary}
                themeText={page.theme.text}
                onPatch={(p) => patchBlock(activeSection.id, sel.colIdx!, sel.blockId!, p)}
                onRemove={() => removeBlock(activeSection.id, sel.colIdx!, sel.blockId!)}
                onOpenPicker={() => setPicking({ sectionId: activeSection.id, colIdx: sel.colIdx!, blockId: sel.blockId! })}
                onClose={() => setSel(null)}
              />
            ) : (
              <SectionInspector
                key={activeSection.id}
                section={activeSection}
                onPatch={(p) => patchSection(activeSection.id, p)}
                onAddBlock={(ci, type) => addBlock(activeSection.id, ci, type)}
                onRemove={() => removeSection(activeSection.id)}
                onClose={() => setSel(null)}
              />
            )}
          </Card>
        )}
      </div>

      {canManage && !inspectorOpen && (
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          <MousePointerClick size={13} /> Tip: click any heading, paragraph, button or image on the canvas to edit it - or click a section&apos;s background to change the band.
        </p>
      )}

      <MediaPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        onPick={(img: PickedImage) => {
          if (!picking) return;
          const section = sections.find((s) => s.id === picking.sectionId);
          const existingAlt = section?.columns[picking.colIdx]?.find((x) => x.id === picking.blockId)?.alt;
          // The intrinsic dimensions come across with the URL. That is the whole reason the picker
          // returns an object rather than a string: without them the renderer guesses, and the
          // page shifts under the visitor as each image arrives.
          patchBlock(picking.sectionId, picking.colIdx, picking.blockId, {
            url: img.url,
            width: img.width ?? undefined,
            height: img.height ?? undefined,
            // An alt already written for THIS placement wins - it is the more specific description
            // of the two, and swapping the image should not silently discard someone's wording.
            ...(existingAlt ? {} : img.alt ? { alt: img.alt } : {}),
          });
          setPicking(null);
        }}
      />
    </div>
  );
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
