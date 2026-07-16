"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { askConfirm, toast } from "@/components/ui/feedback";
import { resetSectionsConfig, saveSectionsConfig } from "@/server/console-actions";
import {
  APP_ROLES,
  SECTION_GROUPS,
  SECTION_ICON_NAMES,
  type AppRole,
  type ResolvedSection,
  type SectionGroup,
  type SectionIconName,
  type SectionsConfig,
} from "@/lib/sections";
import { FallbackIcon, SECTION_ICONS } from "@/components/shell/section-icons";
import { Card, ColHead, ColRow, Hint, Picker, SaveBar, TextIn, Toggle, type Cols } from "./kit";

/**
 * Every nav section: rename it, re-icon it, move it, group it, switch it off, and
 * choose which roles get it by default. The `console` row is locked — the founder
 * can rename it, but hiding it would leave no way back in.
 *
 * Per-user overrides still win over these role defaults; they're edited in
 * Users → Users & access.
 */

const ICON_OPTIONS = SECTION_ICON_NAMES.map((n) => ({ value: n, label: n }));
const GROUP_OPTIONS = SECTION_GROUPS.map((g) => ({ value: g, label: g }));

const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: "Admin",
  HEAD: "Head coach",
  USER: "Telecaller",
  STUDENT: "Student",
  TUTOR: "Tutor",
};

/**
 * Shared by the header and every row — see the note in kit.tsx. The path column takes
 * the slack rather than the label: a section name is two words, and letting the label
 * absorb it left a 400px input holding "Finance".
 */
const SECTION_COLS: Cols = "1.25rem 1.25rem minmax(7rem,16rem) minmax(7rem,9.5rem) minmax(6rem,8rem) minmax(5rem,1fr) 5.5rem";

export function SectionsPanel({ sections }: { sections: ResolvedSection[] }) {
  const [rows, setRows] = useState<ResolvedSection[]>(sections);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<ResolvedSection>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  /** Swap two neighbours' positions, then renumber so `order` stays a clean 10, 20, 30… */
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    setRows(next.map((r, i) => ({ ...r, order: (i + 1) * 10 })));
    setDirty(true);
  };

  const toggleRole = (key: string, role: AppRole) => {
    const row = rows.find((r) => r.key === key)!;
    const roles = row.roles.includes(role) ? row.roles.filter((r) => r !== role) : [...row.roles, role];
    update(key, { roles });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const config: SectionsConfig = {
      entries: rows.map(({ key, label, icon, group, order, enabled, roles }) => ({
        key, label, icon, group, order, enabled, roles,
      })),
    };
    const form = new FormData();
    form.set("config", JSON.stringify(config));
    const res = await saveSectionsConfig(form);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDirty(false);
    toast("Sections saved — the sidebar updates on the next page load");
  };

  const reset = async () => {
    const ok = await askConfirm({
      title: "Reset every section?",
      body: "Labels, icons, order, grouping and role defaults all go back to how the app shipped. Per-user access overrides are not touched.",
      confirmLabel: "Reset sections",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await resetSectionsConfig();
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast("Sections reset to defaults — reload to see them");
  };

  return (
    <Card
      title="Sections"
      subtitle="Rename, reorder, regroup, switch off, and set which roles see each section by default."
    >
      <ColHead cols={SECTION_COLS} labels={["", "", "Label", "Icon", "Group", "Path", "Status"]} />
      <div className="space-y-1.5">
        {rows.map((s, i) => {
          const Icon = SECTION_ICONS[s.icon] ?? FallbackIcon;
          return (
            <ColRow
              key={s.key}
              cols={SECTION_COLS}
              index={i}
              dim={!s.enabled}
              sub={
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-label font-semibold uppercase text-ink-3">Default access</span>
                  {APP_ROLES.map((role) => (
                    <Toggle
                      key={role}
                      checked={s.roles.includes(role)}
                      disabled={s.locked || !s.enabled}
                      onChange={() => toggleRole(s.key, role)}
                      label={ROLE_LABELS[role]}
                      title={
                        s.locked
                          ? "Locked to Admin"
                          : !s.enabled
                            ? "Switch the section on to change its roles"
                            : undefined
                      }
                    />
                  ))}
                </div>
              }
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${s.label} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded text-ink-3 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.label} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded text-ink-3 transition-colors hover:text-ink disabled:opacity-30"
                >
                  <ChevronDown size={15} />
                </button>
              </div>

              <Icon size={17} className="text-ink-2" />

              <TextIn
                ariaLabel={`Label for ${s.key}`}
                value={s.label}
                onChange={(label) => update(s.key, { label })}
              />
              <Picker
                ariaLabel={`Icon for ${s.label}`}
                value={s.icon}
                onChange={(icon) => update(s.key, { icon: icon as SectionIconName })}
                options={ICON_OPTIONS}
              />
              <Picker
                ariaLabel={`Group for ${s.label}`}
                value={s.group}
                onChange={(group) => update(s.key, { group: group as SectionGroup })}
                options={GROUP_OPTIONS}
              />

              <span className="truncate font-mono text-caption text-ink-3" title={s.href}>
                {s.href}
              </span>

              {s.locked ? (
                <span className="flex items-center gap-1 text-caption text-muted" title="Always on, always Admin-only">
                  <Lock size={13} /> Locked
                </span>
              ) : (
                <Toggle
                  checked={s.enabled}
                  onChange={(enabled) => update(s.key, { enabled })}
                  label={s.enabled ? "On" : "Off"}
                />
              )}
            </ColRow>
          );
        })}
      </div>

      <div className="mt-4 space-y-1">
        <Hint>
          Admins always see every switched-on section. Switching a section off hides it from
          everyone, including you — except the locked Founder Console.
        </Hint>
        <Hint>
          These are <b>defaults</b>. A per-user override, set in Users → Users &amp; access, still wins.
        </Hint>
      </div>

      <SaveBar dirty={dirty} onSave={save} onReset={reset} busy={busy} error={error} />
    </Card>
  );
}
