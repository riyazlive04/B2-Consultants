"use client";

import { useState } from "react";
import { Trash2, Copy, ArrowUp, ArrowDown, X, Library } from "lucide-react";
import type { Block, NodeStyle } from "@/lib/sites-types";
import { blockLabel } from "@/lib/sites-types";
import { Btn, IconButton } from "@/components/ui/controls";
import { Select } from "@/components/ui/form";

/**
 * The right-hand panel: everything about the selected node.
 *
 * Two tabs, matching how people actually work - WHAT it says, then HOW it looks. Mixing them
 * (the old builder's single flat form) meant hunting for a font size among paragraph textareas.
 *
 * ── Desktop vs phone ───────────────────────────────────────────────────────────
 * The Styles tab writes to `style` or to `styleMobile` depending on the device toggle, so the
 * same controls serve both and there is no second panel to keep in sync. A field that has no
 * phone override shows the desktop value as its placeholder rather than as its value - otherwise
 * merely opening the phone view would bake a copy of every desktop value into the override and
 * the two could never diverge again.
 */

const inputCls = "h-9 w-full rounded-field border border-line bg-surface px-2.5 text-sm outline-none focus:border-primary";
const areaCls = "w-full rounded-field border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-primary";
const labelCls = "block text-caption font-semibold uppercase tracking-wide text-ink-3";

export default function Inspector({
  node,
  device,
  onPatch,
  onPatchStyle,
  onDuplicate,
  onDelete,
  onNudge,
  onClose,
  forms,
  breadcrumb,
  onSelect,
  onSaveAsSection,
}: {
  node: Block;
  device: "desktop" | "mobile";
  onPatch: (patch: Partial<Block>) => void;
  onPatchStyle: (patch: Partial<NodeStyle>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNudge: (dir: -1 | 1) => void;
  onClose: () => void;
  forms: { id: string; name: string }[];
  breadcrumb: Block[];
  onSelect: (id: string) => void;
  /** Save this node and everything under it to the shared section library. */
  onSaveAsSection?: () => void;
}) {
  const [tab, setTab] = useState<"general" | "styles">("general");
  const s: Partial<NodeStyle> = (device === "mobile" ? node.styleMobile : node.style) ?? {};
  const base: NodeStyle = node.style ?? {};

  /** Empty string clears the override rather than writing 0 - "unset" and "zero" differ. */
  const num = (key: keyof NodeStyle) => ({
    value: (s[key] as number | undefined) ?? "",
    placeholder: device === "mobile" && base[key] != null ? `${base[key]} (desktop)` : "auto",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onPatchStyle({ [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<NodeStyle>),
  });

  const pad = s.padding ?? base.padding ?? [0, 0, 0, 0];
  const setPad = (i: number, v: string) => {
    const next = [...(s.padding ?? base.padding ?? [0, 0, 0, 0])] as [number, number, number, number];
    next[i] = Number(v) || 0;
    onPatchStyle({ padding: next });
  };

  return (
    <aside className="flex w-[320px] flex-none flex-col overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{blockLabel(node.type)}</p>
          {breadcrumb.length > 0 && (
            <p className="mt-0.5 truncate text-caption text-ink-3">
              {breadcrumb.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && " / "}
                  <button className="hover:text-primary hover:underline" onClick={() => onSelect(a.id)}>
                    {blockLabel(a.type)}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-none items-center gap-0.5">
          <IconButton label="Move up" onClick={() => onNudge(-1)}><ArrowUp size={14} /></IconButton>
          <IconButton label="Move down" onClick={() => onNudge(1)}><ArrowDown size={14} /></IconButton>
          <IconButton label="Duplicate" onClick={onDuplicate}><Copy size={14} /></IconButton>
          {/* Saving a node to the shared library sits beside duplicate on purpose: they are the
              same intent at two scopes - "I want this again", here or on another page. */}
          {onSaveAsSection && (
            <IconButton label="Save to section library" onClick={onSaveAsSection}><Library size={14} /></IconButton>
          )}
          <IconButton label="Delete" onClick={onDelete}><Trash2 size={14} /></IconButton>
          <IconButton label="Close" onClick={onClose}><X size={14} /></IconButton>
        </div>
      </header>

      <nav className="flex border-b border-line">
        {(["general", "styles"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-sm font-semibold capitalize ${tab === t ? "border-b-2 border-primary text-primary-strong" : "text-ink-3 hover:text-ink-2"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tab === "general" ? (
          <GeneralFields node={node} onPatch={onPatch} forms={forms} />
        ) : (
          <>
            {device === "mobile" && (
              <p className="rounded-field bg-primary-soft px-2.5 py-2 text-caption text-primary-strong">
                Editing the phone override. Blank fields inherit the desktop value.
              </p>
            )}

            <Group title="Typography">
              <Two>
                <Field label="Size (px)"><input type="number" className={inputCls} {...num("fontSize")} /></Field>
                <Field label="Weight"><input type="number" step={100} className={inputCls} {...num("fontWeight")} /></Field>
              </Two>
              <Two>
                <Field label="Line height"><input type="number" step={0.05} className={inputCls} {...num("lineHeight")} /></Field>
                <Field label="Letter spacing"><input type="number" step={0.5} className={inputCls} {...num("letterSpacing")} /></Field>
              </Two>
              <Field label="Align">
                <Select
                  size="sm"
                  value={s.align ?? ""}
                  onChange={(e) => onPatchStyle({ align: (e.target.value || undefined) as NodeStyle["align"] })}
                  options={[{ value: "", label: "- inherit -" }, { value: "left", label: "Left" }, { value: "center", label: "Centre" }, { value: "right", label: "Right" }]}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={!!s.italic} onChange={(e) => onPatchStyle({ italic: e.target.checked || undefined })} />
                Italic
              </label>
              <Field label="Text colour"><ColourInput value={s.color} onChange={(v) => onPatchStyle({ color: v })} /></Field>
            </Group>

            <Group title="Spacing">
              <Field label="Padding - top / right / bottom / left">
                <div className="grid grid-cols-4 gap-1.5">
                  {pad.map((v, i) => (
                    <input key={i} type="number" className={inputCls} value={v} onChange={(e) => setPad(i, e.target.value)} />
                  ))}
                </div>
              </Field>
              <Two>
                <Field label="Gap"><input type="number" className={inputCls} {...num("gap")} /></Field>
                <Field label="Max width"><input type="number" className={inputCls} {...num("maxWidth")} /></Field>
              </Two>
            </Group>

            <Group title="Background & border">
              {node.type === "section" && (
                <Field label="Band">
                  <Select
                    size="sm"
                    value={node.background ?? "plain"}
                    onChange={(e) => onPatch({ background: e.target.value as Block["background"] })}
                    options={[
                      { value: "plain", label: "Plain" }, { value: "muted", label: "Muted grey" },
                      { value: "dark", label: "Dark (inverted text)" }, { value: "brand", label: "Brand colour" },
                    ]}
                  />
                </Field>
              )}
              <Field label="Background"><ColourInput value={s.background} onChange={(v) => onPatchStyle({ background: v })} /></Field>
              <Two>
                <Field label="Radius"><input type="number" className={inputCls} {...num("radius")} /></Field>
                <Field label="Border width"><input type="number" className={inputCls} {...num("borderWidth")} /></Field>
              </Two>
              <Field label="Border colour"><ColourInput value={s.borderColor} onChange={(v) => onPatchStyle({ borderColor: v })} /></Field>
              <Field label="Shadow">
                <Select
                  size="sm"
                  value={s.shadow ?? ""}
                  onChange={(e) => onPatchStyle({ shadow: (e.target.value || undefined) as NodeStyle["shadow"] })}
                  options={[{ value: "", label: "- none -" }, { value: "card", label: "Card" }, { value: "soft", label: "Soft" }]}
                />
              </Field>
            </Group>

            {node.type === "column" && (
              <Group title="Column">
                <Field label="Width share (1 = equal, 2 = twice as wide)">
                  <input type="number" step={0.1} className={inputCls} {...num("grow")} />
                </Field>
              </Group>
            )}

            <label className="flex items-center gap-2 pt-1 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={!!s.hidden}
                onChange={(e) => onPatchStyle({ hidden: e.target.checked || undefined })}
              />
              Hide {device === "mobile" ? "on phones" : "on desktop"}
            </label>
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * What clicking this node does: follow a link, or raise a form in a popup.
 *
 * One control rather than a "popup form" field sitting quietly beside the link field. With two
 * independent inputs, filling in both is not an error state anyone would notice - the page just
 * silently does one of them, and the author's mental model of their own CTA is wrong until a
 * visitor complains. A single choice makes the two mutually exclusive on screen, which is what
 * they are at render time.
 *
 * The link is kept in `href` while the popup is selected (and vice versa), so switching back and
 * forth does not make the author retype anything.
 */
function OnClickFields({ node, onPatch, forms }: { node: Block; onPatch: (p: Partial<Block>) => void; forms: { id: string; name: string }[] }) {
  const mode = node.opensFormId ? "popup" : "link";
  const isButton = node.type === "button";
  return (
    <>
      <Field label="On click">
        <Select
          size="sm"
          value={mode}
          onChange={(e) =>
            // Clearing to `undefined` rather than "" - an empty string is a form id that matches
            // nothing, which renders as a dead button instead of a link.
            onPatch(e.target.value === "popup" ? { opensFormId: forms[0]?.id ?? "" } : { opensFormId: undefined })
          }
          options={[
            { value: "link", label: isButton ? "Go to a link" : "Do nothing" },
            { value: "popup", label: "Open a form popup" },
          ]}
        />
      </Field>

      {mode === "link" ? (
        isButton ? (
          <Field label="Link"><input className={inputCls} value={node.href ?? ""} onChange={(e) => onPatch({ href: e.target.value })} placeholder="/book or https://…" /></Field>
        ) : null
      ) : (
        <>
          <Field label="Form to open">
            <Select
              size="sm"
              placeholder="- pick a published form -"
              value={node.opensFormId ?? ""}
              onChange={(e) => onPatch({ opensFormId: e.target.value })}
              options={forms.map((f) => ({ value: f.id, label: f.name }))}
            />
          </Field>
          <Field label="Popup headline">
            <textarea
              className={areaCls}
              rows={2}
              value={node.modalTitle ?? ""}
              onChange={(e) => onPatch({ modalTitle: e.target.value })}
              placeholder="Uses the form's own name when blank"
            />
          </Field>
          <Field label="Popup subline">
            <input
              className={inputCls}
              value={node.modalSubtitle ?? ""}
              onChange={(e) => onPatch({ modalSubtitle: e.target.value })}
              placeholder="20 minutes. Free. Changes everything."
            />
          </Field>
          {forms.length === 0 && (
            <p className="text-caption text-risk">No published forms yet - publish one under Forms first.</p>
          )}
        </>
      )}
    </>
  );
}

function GeneralFields({ node, onPatch, forms }: { node: Block; onPatch: (p: Partial<Block>) => void; forms: { id: string; name: string }[] }) {
  switch (node.type) {
    case "heading":
    case "subheading":
    case "eyebrow":
    case "text":
      return (
        <Field label="Text">
          <textarea className={areaCls} rows={node.type === "text" ? 5 : 2} value={node.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} />
        </Field>
      );
    case "bullets":
      return (
        <>
          <Field label="Items - one per line">
            <textarea className={areaCls} rows={6} value={(node.items ?? []).join("\n")} onChange={(e) => onPatch({ items: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Style">
            <Select size="sm" value={node.variant ?? "dot"} onChange={(e) => onPatch({ variant: (e.target.value === "dot" ? undefined : e.target.value) as Block["variant"] })} options={[{ value: "dot", label: "• Bullets" }, { value: "check", label: "✔ Checklist" }, { value: "dash", label: "- Dashes" }]} />
          </Field>
        </>
      );
    case "image":
      return (
        <>
          <Field label="Image URL"><input className={inputCls} value={node.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} placeholder="/media/… or https://…" /></Field>
          <Field label="Alt text"><input className={inputCls} value={node.alt ?? ""} onChange={(e) => onPatch({ alt: e.target.value })} /></Field>
          <OnClickFields node={node} onPatch={onPatch} forms={forms} />
        </>
      );
    case "video":
      return <Field label="Embed URL"><input className={inputCls} value={node.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} placeholder="https://www.youtube.com/embed/…" /></Field>;
    case "button":
      return (
        <>
          <Field label="Label"><input className={inputCls} value={node.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} /></Field>
          <OnClickFields node={node} onPatch={onPatch} forms={forms} />
          <Field label="Style">
            <Select size="sm" value={node.variant ?? "primary"} onChange={(e) => onPatch({ variant: e.target.value as Block["variant"] })} options={[{ value: "primary", label: "Primary" }, { value: "accent", label: "Accent (amber)" }, { value: "soft", label: "Soft" }, { value: "outline", label: "Outline" }]} />
          </Field>
        </>
      );
    case "stat":
      return (
        <>
          <Field label="Figure"><input className={inputCls} value={node.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} /></Field>
          <Field label="Caption"><input className={inputCls} value={node.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} /></Field>
        </>
      );
    case "pill":
    case "avatar":
    case "dot":
      return (
        <>
          {node.type !== "dot" && (
            <Field label={node.type === "avatar" ? "Initials" : "Label"}>
              <input className={inputCls} value={node.text ?? ""} onChange={(e) => onPatch({ text: e.target.value })} />
            </Field>
          )}
          <Field label="Colour">
            <Select
              size="sm"
              value={node.tone ?? "neutral"}
              onChange={(e) => onPatch({ tone: e.target.value as Block["tone"] })}
              options={[
                { value: "neutral", label: "Neutral grey" }, { value: "amber", label: "Amber" },
                { value: "blue", label: "Blue" }, { value: "green", label: "Green" },
                { value: "orange", label: "Orange" }, { value: "violet", label: "Violet" },
                { value: "navy", label: "Navy" },
              ]}
            />
          </Field>
        </>
      );
    case "spacer":
      return <Field label="Height (px)"><input type="number" className={inputCls} value={node.size ?? 24} onChange={(e) => onPatch({ size: Number(e.target.value) || 0 })} /></Field>;
    case "form":
      return (
        <Field label="Form">
          <Select placeholder="- pick a published form -" value={node.formId ?? ""} onChange={(e) => onPatch({ formId: e.target.value })} options={forms.map((f) => ({ value: f.id, label: f.name }))} />
        </Field>
      );
    case "html":
      return (
        <>
          <Field label="HTML / Javascript">
            <textarea className={`${areaCls} font-mono text-caption`} rows={12} value={node.html ?? ""} onChange={(e) => onPatch({ html: e.target.value })} />
          </Field>
          <p className="text-caption text-ink-3">Runs on the live page with no sandbox. Only paste markup you trust.</p>
        </>
      );
    default:
      return <p className="text-caption text-ink-3">Select the blocks inside this container to edit them, or use the Styles tab.</p>;
  }
}

// ── small presentational helpers ──
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-field border border-line p-2.5">
      <p className="text-caption font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className={labelCls}>{label}</span>{children}</label>;
}
function Two({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

/**
 * A colour field that takes a design token OR a hex value.
 *
 * Tokens are offered first and by name, because a page built from `primary`/`ink` follows a
 * rebrand automatically while one built from `#4949ef` has to be hunted down field by field.
 */
function ColourInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const TOKENS = ["primary", "primary-strong", "primary-soft", "ink", "ink-2", "ink-3", "surface", "surface-2", "line", "on-accent"];
  const isToken = !!value && TOKENS.includes(value);
  return (
    <div className="flex gap-1.5">
      <Select
        size="sm"
        value={isToken ? value : value ? "__custom" : ""}
        onChange={(e) => onChange(e.target.value === "__custom" ? "#000000" : e.target.value || undefined)}
        options={[{ value: "", label: "- inherit -" }, ...TOKENS.map((t) => ({ value: t, label: t })), { value: "__custom", label: "Custom…" }]}
      />
      {!!value && !isToken && (
        <input type="color" className="h-9 w-10 flex-none rounded-field border border-line bg-surface" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
