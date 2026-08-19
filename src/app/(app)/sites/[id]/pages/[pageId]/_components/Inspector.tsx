"use client";

import { useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Hint } from "@/components/ui/kit";
import { Select } from "@/components/ui/form";
import type { BlockStyle, SiteBlock, SiteBlockType, SiteSectionBlock } from "@/lib/site-types";

/**
 * The right-hand properties panel of the page builder.
 *
 * Click an element on the canvas and this shows its properties: General (what it says, where it
 * links) and Styles (how it looks). Click a section's band and it shows the band's own settings
 * plus a way to add elements into it. One panel, driven by the selection - the author never has
 * to find the right form in a list.
 */

const input =
  "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";
const area =
  "w-full rounded-field border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

const BLOCK_LABEL: Record<SiteBlockType, string> = {
  heading: "Heading",
  subheading: "Sub heading",
  text: "Paragraph",
  image: "Image",
  button: "Button",
  bullets: "Bullet list",
  divider: "Divider",
  spacer: "Spacer",
  video: "Video",
  map: "Map",
  form: "Form",
  nav: "Menu",
  logo: "Logo",
  footerLinks: "Footer links",
};

/** Elements an author can add into a section by hand. Header/footer-only types are left out. */
const ADDABLE: SiteBlockType[] = ["heading", "subheading", "text", "button", "image", "bullets", "video", "map", "divider", "spacer"];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-caption font-semibold uppercase tracking-wide text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-caption text-ink-3">{hint}</span>}
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="mb-2 text-[13px] font-semibold text-ink">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
  hint,
}: {
  label: string;
  value: string | undefined;
  /** What the element uses when no override is set - shown in the swatch so "unset" is not black. */
  fallback: string;
  onChange: (v: string | undefined) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-1.5">
        <input
          type="color"
          className="h-9 w-12 flex-none rounded-field border border-line bg-surface"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={input}
          placeholder={`Theme (${fallback})`}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {value && (
          <button type="button" title="Use the theme colour" onClick={() => onChange(undefined)} className="grid h-9 w-9 flex-none place-items-center rounded-field border border-line text-ink-3 hover:bg-surface-2">
            <X size={13} />
          </button>
        )}
      </div>
    </Field>
  );
}

function SliderNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "px",
  placeholder,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  placeholder: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value ?? min}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--primary)]"
        />
        <input
          type="number"
          className={`${input} w-20 flex-none`}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        <span className="w-6 flex-none text-caption text-ink-3">{unit}</span>
      </div>
    </Field>
  );
}

// ───────────────────────────── Block inspector ─────────────────────────────

export function BlockInspector({
  block,
  themePrimary,
  themeText,
  onPatch,
  onRemove,
  onOpenPicker,
  onClose,
}: {
  block: SiteBlock;
  themePrimary: string;
  themeText: string;
  onPatch: (patch: Partial<SiteBlock>) => void;
  onRemove: () => void;
  onOpenPicker: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"general" | "styles">("general");
  const patchStyle = (p: Partial<BlockStyle>) => {
    const next: BlockStyle = { ...(block.style ?? {}), ...p };
    // Drop cleared keys so the stored shape stays minimal and "no override" is absence, not null.
    for (const k of Object.keys(next) as (keyof BlockStyle)[]) if (next[k] === undefined) delete next[k];
    onPatch({ style: Object.keys(next).length ? next : undefined });
  };
  const s = block.style ?? {};
  const isText = block.type === "heading" || block.type === "subheading" || block.type === "text" || block.type === "bullets";
  const isButton = block.type === "button";
  const hasTypography = isText || isButton;
  const hasAlign = isText || isButton || block.type === "image" || block.type === "logo" || block.type === "nav" || block.type === "footerLinks";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{BLOCK_LABEL[block.type]}</p>
          <p className="truncate font-mono text-caption text-ink-3">{block.id}</p>
        </div>
        <button type="button" aria-label="Deselect" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-btn text-ink-3 hover:bg-surface-2 hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-line px-4 pt-2">
        {(["general", "styles"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium capitalize ${
              tab === t ? "border-primary text-primary-strong" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {tab === "general" && (
          <>
            {(block.type === "heading" || block.type === "subheading" || block.type === "text") && (
              <Field label="Text">
                <textarea
                  className={area}
                  rows={block.type === "text" ? 5 : 2}
                  value={block.text ?? ""}
                  onChange={(e) => onPatch({ text: e.target.value })}
                />
              </Field>
            )}

            {block.type === "bullets" && (
              <Field label="Items" hint="One item per line.">
                <textarea
                  className={area}
                  rows={5}
                  value={(block.items ?? []).join("\n")}
                  onChange={(e) => onPatch({ items: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                />
              </Field>
            )}

            {block.type === "footerLinks" && (
              <Field label="Links" hint="Label|/path - one per line.">
                <textarea
                  className={area}
                  rows={4}
                  value={(block.items ?? []).join("\n")}
                  onChange={(e) => onPatch({ items: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                />
              </Field>
            )}

            {isButton && (
              <>
                <Field label="Text">
                  <input className={input} value={block.label ?? ""} onChange={(e) => onPatch({ label: e.target.value })} placeholder="Watch Free Training" />
                </Field>
                <Field label="Sub text" hint="Optional smaller line under the label.">
                  <input className={input} value={block.subText ?? ""} onChange={(e) => onPatch({ subText: e.target.value || undefined })} placeholder="Free · 45 minutes" />
                </Field>
                <Group title="Button actions">
                  <Field label="Website URL">
                    <input className={input} value={block.href ?? ""} onChange={(e) => onPatch({ href: e.target.value })} placeholder="https://… or /path" />
                  </Field>
                  <label className="flex items-center justify-between gap-2 text-sm text-ink-2">
                    Open in new tab
                    <input type="checkbox" checked={block.newTab ?? false} onChange={(e) => onPatch({ newTab: e.target.checked })} />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-sm text-ink-2">
                    <span>
                      Carry utm &amp; click ids
                      <span className="block text-caption text-ink-3">Keeps ad attribution across the hop.</span>
                    </span>
                    <input type="checkbox" checked={block.forwardParams ?? false} onChange={(e) => onPatch({ forwardParams: e.target.checked })} />
                  </label>
                </Group>
              </>
            )}

            {(block.type === "image" || block.type === "logo") && (
              <>
                {block.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={block.url} alt={block.alt ?? ""} className="h-28 w-full rounded-field bg-surface-2 object-contain" />
                )}
                <Btn size="sm" variant="outline" icon={<ImageIcon size={13} />} onClick={onOpenPicker}>
                  {block.url ? "Replace image" : "Choose image"}
                </Btn>
                <Field label="Image URL">
                  <input className={input} value={block.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} />
                </Field>
                <Field label="Alt text" hint="Read by screen readers and shown if the image fails.">
                  <input className={input} value={block.alt ?? ""} onChange={(e) => onPatch({ alt: e.target.value })} />
                </Field>
                {block.type === "image" && (
                  <label className="flex items-center justify-between gap-2 text-sm text-ink-2">
                    Circular crop
                    <input type="checkbox" checked={block.rounded ?? false} onChange={(e) => onPatch({ rounded: e.target.checked })} />
                  </label>
                )}
                <Hint>Picking from the library also records the real dimensions, which stops the page jumping as it loads.</Hint>
              </>
            )}

            {(block.type === "video" || block.type === "map") && (
              <Field label="Embed URL" hint={block.type === "video" ? "YouTube / Vimeo embed link." : "Google Maps embed link."}>
                <input className={input} value={block.url ?? ""} onChange={(e) => onPatch({ url: e.target.value })} />
              </Field>
            )}

            {block.type === "spacer" && (
              <SliderNumber label="Height" value={block.size} min={4} max={240} placeholder="24" onChange={(v) => onPatch({ size: v })} />
            )}

            {block.type === "nav" && <Hint>The menu items are edited once on the site&apos;s Menu tab and shown on every page.</Hint>}
            {block.type === "divider" && <Hint>A thin rule. Its colour follows the band it sits on.</Hint>}
          </>
        )}

        {tab === "styles" && (
          <>
            {hasAlign && (
              <Field label="Alignment">
                <div className="flex gap-1">
                  {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
                    <button
                      key={a}
                      type="button"
                      aria-label={`Align ${a}`}
                      aria-pressed={(block.align ?? "left") === a}
                      onClick={() => onPatch({ align: a })}
                      className={`grid h-9 w-9 place-items-center rounded-field border ${
                        (block.align ?? "left") === a ? "border-primary bg-primary-soft text-primary-strong" : "border-line text-ink-2 hover:bg-surface-2"
                      }`}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {hasTypography && (
              <Group title="Typography">
                <SliderNumber label="Font size" value={s.fontSize} min={10} max={96} placeholder="theme" onChange={(v) => patchStyle({ fontSize: v })} />
                <Field label="Font weight">
                  <Select
                    size="sm"
                    value={s.fontWeight !== undefined ? String(s.fontWeight) : ""}
                    onChange={(e) => patchStyle({ fontWeight: e.target.value ? (Number(e.target.value) as BlockStyle["fontWeight"]) : undefined })}
                    options={[
                      { value: "", label: "Theme default" },
                      { value: "400", label: "Regular (400)" },
                      { value: "500", label: "Medium (500)" },
                      { value: "600", label: "Semi-bold (600)" },
                      { value: "700", label: "Bold (700)" },
                      { value: "800", label: "Extra-bold (800)" },
                    ]}
                  />
                </Field>
                <SliderNumber label="Letter spacing" value={s.letterSpacing} min={-3} max={12} step={0.5} placeholder="0" onChange={(v) => patchStyle({ letterSpacing: v })} />
                <Field label="Text transform">
                  <Select
                    size="sm"
                    value={s.textTransform ?? ""}
                    onChange={(e) => patchStyle({ textTransform: (e.target.value || undefined) as BlockStyle["textTransform"] })}
                    options={[
                      { value: "", label: "Normal" },
                      { value: "uppercase", label: "UPPERCASE" },
                      { value: "capitalize", label: "Capitalize Each Word" },
                    ]}
                  />
                </Field>
              </Group>
            )}

            {(hasTypography || block.type === "nav" || block.type === "footerLinks") && (
              <Group title="Colour">
                <ColorField
                  label="Text colour"
                  value={block.color}
                  fallback={isButton ? "#ffffff" : themeText}
                  onChange={(v) => onPatch({ color: v })}
                  hint="Leave empty to follow the theme - text on a coloured band turns white automatically."
                />
                {isButton && (
                  <>
                    <ColorField label="Background colour" value={s.background} fallback={themePrimary} onChange={(v) => patchStyle({ background: v })} />
                    <Field label="Style">
                      <Select
                        size="sm"
                        value={block.variant ?? "primary"}
                        onChange={(e) => onPatch({ variant: e.target.value as SiteBlock["variant"] })}
                        options={[
                          { value: "primary", label: "Filled" },
                          { value: "soft", label: "White" },
                          { value: "outline", label: "Outline" },
                        ]}
                      />
                    </Field>
                    <SliderNumber label="Corner radius" value={s.radius} min={0} max={40} placeholder="theme" onChange={(v) => patchStyle({ radius: v })} />
                  </>
                )}
              </Group>
            )}

            {!hasTypography && !hasAlign && <Hint>This element has no style options of its own.</Hint>}
          </>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <Btn size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={onRemove} className="text-risk hover:bg-risk-soft">
          Remove element
        </Btn>
      </div>
    </div>
  );
}

// ───────────────────────────── Section inspector ─────────────────────────────

export function SectionInspector({
  section,
  onPatch,
  onAddBlock,
  onRemove,
  onClose,
}: {
  section: SiteSectionBlock;
  onPatch: (patch: Partial<SiteSectionBlock>) => void;
  onAddBlock: (colIdx: number, type: SiteBlockType) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const bg = section.background;
  const [addCol, setAddCol] = useState(0);
  const [addType, setAddType] = useState<SiteBlockType>("text");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">Section</p>
          <p className="truncate text-caption text-ink-3">Band styling and layout</p>
        </div>
        <button type="button" aria-label="Deselect" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-btn text-ink-3 hover:bg-surface-2 hover:text-ink">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="Name" hint="Shown in the editor only.">
          <input className={input} value={section.name ?? ""} onChange={(e) => onPatch({ name: e.target.value })} placeholder="Hero" />
        </Field>

        <Group title="Layout">
          <Field label="Width">
            <Select
              size="sm"
              value={section.width}
              onChange={(e) => onPatch({ width: e.target.value as SiteSectionBlock["width"] })}
              options={[
                { value: "full", label: "Full bleed" },
                { value: "contained", label: "Contained" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {(["Top", "Bottom"] as const).map((lbl, idx) => (
              <Field key={lbl} label={`Padding ${lbl.toLowerCase()}`}>
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
              </Field>
            ))}
          </div>
        </Group>

        <Group title="Background">
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
          {bg.kind === "color" && (
            <div className="flex gap-1.5">
              <input type="color" className="h-9 w-12 flex-none rounded-field border border-line bg-surface" value={bg.color} onChange={(e) => onPatch({ background: { kind: "color", color: e.target.value } })} />
              <input className={input} value={bg.color} onChange={(e) => onPatch({ background: { kind: "color", color: e.target.value } })} />
            </div>
          )}
          {bg.kind === "image" && (
            <input className={input} placeholder="Image URL" value={bg.url} onChange={(e) => onPatch({ background: { kind: "image", url: e.target.value, overlay: bg.overlay } })} />
          )}
        </Group>

        <Group title="Add an element">
          <div className="flex flex-wrap gap-1.5">
            {section.columns.length > 1 && (
              <Select
                size="sm"
                value={String(addCol)}
                onChange={(e) => setAddCol(Number(e.target.value))}
                options={section.columns.map((_, i) => ({ value: String(i), label: `Column ${i + 1}` }))}
                className="w-28"
              />
            )}
            <Select
              size="sm"
              value={addType}
              onChange={(e) => setAddType(e.target.value as SiteBlockType)}
              options={ADDABLE.map((t) => ({ value: t, label: BLOCK_LABEL[t] }))}
              className="min-w-0 flex-1"
            />
            <Btn size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => onAddBlock(addCol, addType)}>
              Add
            </Btn>
          </div>
          <Hint>The new element lands at the bottom of the column - click it on the canvas to edit it.</Hint>
        </Group>
      </div>

      <div className="border-t border-line px-4 py-3">
        <Btn size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={onRemove} className="text-risk hover:bg-risk-soft">
          Remove section
        </Btn>
      </div>
    </div>
  );
}
