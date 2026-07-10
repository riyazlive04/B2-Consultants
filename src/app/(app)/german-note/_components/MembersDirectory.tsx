"use client";

import { useState } from "react";
import { CalendarDays, Heart, Loader2, MessageSquare, Search } from "lucide-react";
import { loadGnMemberProfile } from "@/server/german-note-actions";
import type { GnMemberProfile, GnMemberRow } from "@/server/german-note-metrics";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/format";

function roleChip(role: string) {
  if (role === "TUTOR") return { label: "Tutor", fg: "var(--lvl-gn)", bg: "#3fc0b722" };
  if (role === "ADMIN") return { label: "Admin", fg: "var(--primary-strong)", bg: "var(--primary-soft)" };
  return { label: "Student", fg: "var(--ink-3)", bg: "var(--surface-2)" };
}

function initialsOf(name: string) {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function LevelAvatar({ name, image, level, size = 44 }: { name: string; image: string | null; level: number; size?: number }) {
  return (
    <span className="relative inline-block flex-none" style={{ width: size, height: size }}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center rounded-full bg-[#3fc0b722] text-sm font-bold text-[var(--lvl-gn)]">
          {initialsOf(name)}
        </span>
      )}
      <span className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]">
        {level}
      </span>
    </span>
  );
}

export function MembersDirectory({ members }: { members: GnMemberRow[] }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [profile, setProfile] = useState<GnMemberProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const filtered = q.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
    : members;

  const open = async (userId: string) => {
    setOpenId(userId);
    setProfile(null);
    setLoading(true);
    const res = await loadGnMemberProfile(userId);
    setLoading(false);
    if (res.ok) setProfile(res.profile);
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search members…"
          className="w-full rounded-field border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m) => {
          const chip = roleChip(m.role);
          return (
            <button
              key={m.userId}
              type="button"
              onClick={() => open(m.userId)}
              className="card-hover flex items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card"
            >
              <LevelAvatar name={m.name} image={m.image} level={m.level} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{m.name}</span>
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: chip.fg, background: chip.bg }}>
                    {chip.label}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  Level {m.level} · {m.points} pts{m.batchNames.length ? ` · ${m.batchNames[0]}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">No members match “{q}”.</p>}

      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Member profile" size="md">
        {loading && (
          <div className="grid place-items-center py-10 text-muted">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}
        {!loading && profile && (
          <div>
            <div className="flex items-center gap-4">
              <LevelAvatar name={profile.name} image={profile.image} level={profile.level} size={64} />
              <div>
                <p className="font-display text-lg font-semibold">{profile.name}</p>
                <p className="text-sm text-muted">
                  {roleChip(profile.role).label} · Level {profile.level} · {profile.points} points
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <CalendarDays size={12} /> Joined {formatDate(profile.joinedAt)}
                </p>
              </div>
            </div>

            {profile.batchNames.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {profile.batchNames.map((b) => (
                  <span key={b} className="rounded-full bg-[#3fc0b722] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--lvl-gn)]">{b}</span>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-field bg-surface-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-sm font-bold"><MessageSquare size={13} /> {profile.postCount}</p>
                <p className="text-[11px] text-muted">posts</p>
              </div>
              <div className="rounded-field bg-surface-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-sm font-bold"><MessageSquare size={13} /> {profile.commentCount}</p>
                <p className="text-[11px] text-muted">comments</p>
              </div>
              <div className="rounded-field bg-surface-2 py-2.5">
                <p className="flex items-center justify-center gap-1 text-sm font-bold"><Heart size={13} /> {profile.likesReceived}</p>
                <p className="text-[11px] text-muted">likes received</p>
              </div>
            </div>

            {profile.recentPosts.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent posts</p>
                <ul className="space-y-1.5">
                  {profile.recentPosts.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 rounded-field bg-surface-2 px-3 py-2 text-sm">
                      <span className="truncate">{p.title ?? "(untitled post)"}</span>
                      <span className="ml-auto flex flex-none items-center gap-2 text-xs text-muted">
                        {p.batchName && <span className="hidden sm:inline">{p.batchName}</span>}
                        <span className="inline-flex items-center gap-0.5"><Heart size={11} /> {p.likeCount}</span>
                        <span>{formatDate(p.createdAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
