"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Lock, Mail, Shield, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { updateMyProfile } from "@/server/profile-actions";
import { Field, FormError, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";

/** Resize an uploaded image to a square ~256px JPEG data URL - keeps the row small. */
function resizeToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        // cover-crop to a centred square
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileClient({
  user,
}: {
  user: { name: string; email: string; image: string | null; roleLabel: string };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user.name);
  const [image, setImage] = useState<string | null>(user.image);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    setError(null);
    try {
      setImage(await resizeToDataUrl(file));
    } catch {
      setError("Could not process that image.");
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("image", image ?? "");
    const res = await updateMyProfile(fd);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast("Profile updated");
    router.refresh();
  };

  return (
    <div className="mt-8 space-y-6">
      {/* Identity card */}
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <div className="relative">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="h-24 w-24 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="grid h-24 w-24 place-items-center rounded-full bg-accent text-2xl font-bold text-white">
                {initials || "?"}
              </span>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Change photo"
              className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-surface bg-primary text-white shadow-soft hover:bg-primary-strong"
            >
              <Camera size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 text-center sm:text-left">
            <p className="font-display text-lg font-semibold">{name || "Your name"}</p>
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted sm:justify-start">
              <Mail size={14} /> {user.email}
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted sm:justify-start">
              <Shield size={14} /> {user.roleLabel}
            </p>
            {image && (
              <button
                type="button"
                onClick={() => setImage(null)}
                className="mt-2 inline-flex items-center gap-1 text-sm text-risk hover:underline"
              >
                <Trash2 size={13} /> Remove photo
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Display name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email" hint="Your login email is managed by an Admin.">
            <TextInput value={user.email} disabled readOnly />
          </Field>
        </div>

        {error && (
          <div className="mt-4">
            <FormError message={error} />
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-strong disabled:opacity-60"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <PasswordCard />
    </div>
  );
}

/** Self-service password change (better-auth). Requires the current password. */
function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    setBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) return setError(error.message ?? "Could not change password.");
    setCurrent("");
    setNext("");
    toast("Password changed");
  };

  return (
    <form onSubmit={submit} className="rounded-card border border-line bg-surface p-6 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Lock size={17} /> Change password
      </h2>
      <p className="mt-1 text-sm text-muted">You&apos;ll stay signed in here; other devices are signed out.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Current password">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}
      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={busy || !current || !next}
          className="inline-flex items-center gap-2 rounded-field border border-line bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Update password
        </button>
      </div>
    </form>
  );
}
