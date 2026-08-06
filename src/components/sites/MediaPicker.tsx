"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Search, Trash2, Upload, X } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Hint } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import { deleteMedia, listMedia, updateMediaAlt, type MediaRow } from "@/server/media-actions";

/**
 * The media library, as a modal picker.
 *
 * Exists because the team creates pages unsupervised. A bare upload button gives you the same logo
 * uploaded eleven times under eleven names; a library that can be searched and re-picked is what
 * makes reuse the easy path.
 *
 * Returns BOTH the url and the intrinsic dimensions, so the block can set width/height and the
 * page stops shifting as images load.
 */

export type PickedImage = { url: string; alt: string | null; width: number | null; height: number | null };

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default function MediaPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (img: PickedImage) => void;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh(q = search) {
    setLoading(true);
    try {
      setRows(await listMedia(q));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh("");
    // Intentionally keyed on `open` alone: reloading on every keystroke of `search` would fire a
    // query per character. The search box refreshes on submit instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        return toast(body.error ?? `Upload failed (${res.status})`, "error");
      }
      toast("Uploaded");
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-card border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <p className="font-display text-h2 font-semibold text-ink">Media library</p>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Search size={14} className="text-ink-3" />
            <input
              className="h-9 min-w-0 flex-1 rounded-field border border-line bg-surface px-2.5 text-sm outline-none focus:border-primary"
              placeholder="Search by filename"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && refresh()}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <Btn size="sm" icon={<Upload size={14} />} busy={uploading} onClick={() => fileRef.current?.click()}>
            Upload
          </Btn>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-ink-3">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center">
              <ImageIcon size={22} className="mx-auto text-ink-3" />
              <p className="mt-2 text-sm text-ink-2">Nothing here yet.</p>
              <Hint>
                If uploading fails with a configuration error, SUPABASE_URL and
                SUPABASE_SERVICE_ROLE_KEY are not set on this environment.
              </Hint>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {rows.map((m) => (
                <div key={m.id} className="group overflow-hidden rounded-field border border-line">
                  <button
                    className="block w-full"
                    onClick={() => {
                      onPick({ url: m.url, alt: m.alt, width: m.width, height: m.height });
                      onClose();
                    }}
                  >
                    {/* A plain <img>: these are library thumbnails inside an admin modal, not page
                        content, so routing them through the optimizer would spend CPU and cache
                        entries on images no visitor ever sees. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.url}
                      alt={m.alt ?? m.filename}
                      className="h-24 w-full bg-surface-2 object-contain"
                      loading="lazy"
                    />
                  </button>
                  <div className="space-y-1 p-1.5">
                    <p className="truncate text-caption text-ink-2" title={m.filename}>{m.filename}</p>
                    <p className="text-caption text-ink-3">
                      {m.width && m.height ? `${m.width}×${m.height} · ` : ""}{kb(m.bytes)}
                    </p>
                    <input
                      className="h-7 w-full rounded-field border border-line bg-surface px-1.5 text-caption outline-none focus:border-primary"
                      placeholder="Alt text"
                      defaultValue={m.alt ?? ""}
                      onBlur={async (e) => {
                        if (e.target.value === (m.alt ?? "")) return;
                        const res = await updateMediaAlt(m.id, e.target.value);
                        if (!res.ok) toast(res.error, "error");
                      }}
                    />
                    <IconButton
                      label="Remove from library"
                      onClick={async () => {
                        if (!(await askConfirm({ title: `Remove "${m.filename}"?`, danger: true }))) return;
                        const res = await deleteMedia(m.id);
                        if (!res.ok) return toast(res.error, "error");
                        toast("Removed");
                        void refresh();
                      }}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
