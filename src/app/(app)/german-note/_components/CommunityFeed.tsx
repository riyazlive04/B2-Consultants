"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, ImagePlus, MessageCircle, Pin, PinOff, Send, Trash2, X } from "lucide-react";
import {
  createGnComment,
  createGnPost,
  deleteGnComment,
  deleteGnPost,
  toggleGnCommentLike,
  toggleGnLike,
  toggleGnPin,
} from "@/server/german-note-actions";
import type { GnFeedComment, GnFeedPost, GnMentionCandidate, GnPostCategoryKey } from "@/server/german-note-metrics";
import { askConfirm, toast } from "@/components/ui/feedback";
import { FormError, Select, SubmitButton } from "@/components/ui/form";
import { formatDuration } from "@/lib/format";
import { MentionText, MentionTextArea } from "./Mentions";

/**
 * Skool-style feed: title + category posts with an optional image, flat
 * comments, like-once on both posts AND comments, @mentions, pinned posts on
 * top, activity bumping, and author level badges from likes received.
 */

const timeAgo = (iso: string) => `${formatDuration(Date.now() - new Date(iso).getTime())} ago`;

const CATEGORIES: { key: GnPostCategoryKey; label: string; fg: string; bg: string }[] = [
  { key: "GENERAL", label: "General", fg: "var(--ink-3)", bg: "var(--surface-2)" },
  { key: "ANNOUNCEMENT", label: "Announcement", fg: "var(--primary-strong)", bg: "var(--primary-soft)" },
  { key: "QUESTION", label: "Question", fg: "var(--lvl-gn)", bg: "#3fc0b722" },
  { key: "WIN", label: "Win", fg: "var(--good)", bg: "var(--good-bg)" },
];
const categoryOf = (key: GnPostCategoryKey) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];

/** Resize an image to a max 1200px longest side JPEG data URL — keeps posts light. */
function resizeImage(file: File, maxDim = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("load"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function CategoryChip({ category }: { category: GnPostCategoryKey }) {
  const c = categoryOf(category);
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: c.fg, background: c.bg }}>
      {c.label}
    </span>
  );
}

function Avatar({ name, image, level }: { name: string | null; image: string | null; level?: number }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="relative inline-block flex-none">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-9 w-9 rounded-full object-cover" />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#3fc0b722] text-xs font-bold text-[var(--lvl-gn)]">
          {initials}
        </span>
      )}
      {level !== undefined && (
        <span
          title={`Level ${level} — earn levels when your posts and comments get likes`}
          className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-primary text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]"
        >
          {level}
        </span>
      )}
    </span>
  );
}

function RoleChip({ role }: { role: string | null }) {
  if (role === "TUTOR")
    return <span className="ml-1.5 rounded-full bg-[#3fc0b722] px-2 py-0.5 text-[10px] font-semibold text-[var(--lvl-gn)]">Tutor</span>;
  if (role === "ADMIN")
    return <span className="ml-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-strong">Admin</span>;
  return null;
}

function CommentRow({
  c,
  candidates,
  canPost,
  onChanged,
}: {
  c: GnFeedComment;
  candidates: GnMentionCandidate[];
  canPost: boolean;
  onChanged: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={c.authorName} image={c.authorImage} level={c.authorLevel} />
      <div className="min-w-0 flex-1 rounded-field bg-surface-2 px-3 py-2">
        <p className="text-xs">
          <span className="font-semibold text-ink">{c.authorName ?? "Former member"}</span>
          <span className="ml-2 text-muted">{timeAgo(c.createdAt)}</span>
          {c.canDelete && (
            <button
              type="button"
              aria-label="Delete comment"
              className="float-right text-muted hover:text-risk"
              onClick={async () => {
                const ok = await askConfirm({ title: "Delete this comment?", confirmLabel: "Delete", danger: true });
                if (!ok) return;
                const res = await deleteGnComment(c.id);
                if (!res.ok) return toast(res.error, "error");
                onChanged();
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-2">
          <MentionText body={c.body} candidates={candidates} />
        </p>
        <button
          type="button"
          disabled={!canPost}
          className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${
            c.likedByMe ? "text-risk" : "text-muted hover:text-ink"
          } disabled:opacity-60`}
          onClick={async () => {
            const res = await toggleGnCommentLike(c.id);
            if (!res.ok) return toast(res.error, "error");
            onChanged();
          }}
        >
          <Heart size={12} fill={c.likedByMe ? "currentColor" : "none"} />
          {c.likeCount > 0 && <span className="tnum">{c.likeCount}</span>}
        </button>
      </div>
    </div>
  );
}

function CommentBox({
  postId,
  candidates,
  onDone,
}: {
  postId: string;
  candidates: GnMentionCandidate[];
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      className="flex items-start gap-2"
      action={async (form) => {
        setError(null);
        const res = await createGnComment(postId, form);
        if (!res.ok) return setError(res.error);
        formRef.current?.reset();
        onDone();
      }}
    >
      <div className="flex-1">
        <MentionTextArea name="body" candidates={candidates} rows={1} placeholder="Write a comment… use @ to mention" required maxLength={2000} />
        <FormError message={error} />
      </div>
      <button
        type="submit"
        aria-label="Send comment"
        className="grid h-9 w-9 flex-none place-items-center rounded-btn bg-primary text-white transition-colors hover:bg-primary-strong"
      >
        <Send size={15} />
      </button>
    </form>
  );
}

export function CommunityFeed({
  batchId,
  posts,
  canPost,
  candidates,
  placeholder = "Share something with the community…",
}: {
  batchId: string | null; // null = global feed
  posts: GnFeedPost[];
  canPost: boolean;
  candidates: GnMentionCandidate[];
  placeholder?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [postError, setPostError] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<GnPostCategoryKey | "ALL">("ALL");
  const [image, setImage] = useState<string | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => startTransition(() => router.refresh());
  const visible = filter === "ALL" ? posts : posts.filter((p) => p.category === filter);

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image file", "error");
    try {
      setImage(await resizeImage(file));
    } catch {
      toast("Could not process that image", "error");
    }
  };

  return (
    <div className="space-y-4">
      {canPost && (
        <form
          ref={composerRef}
          className="rounded-card border border-line bg-surface p-4 shadow-card"
          action={async (form) => {
            setPostError(null);
            const res = await createGnPost(form);
            if (!res.ok) return setPostError(res.error);
            composerRef.current?.reset();
            setImage(null);
            toast("Posted");
            refresh();
          }}
        >
          {batchId && <input type="hidden" name="batchId" value={batchId} />}
          <input type="hidden" name="imageUrl" value={image ?? ""} />
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <input
              name="title"
              maxLength={150}
              placeholder="Title (optional)"
              aria-label="Post title"
              className="w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft"
            />
            <Select name="category" aria-label="Category" options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
          </div>
          <div className="mt-3">
            <MentionTextArea name="body" candidates={candidates} rows={3} placeholder={`${placeholder} — use @ to mention`} required maxLength={5000} />
          </div>
          {image && (
            <div className="relative mt-3 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="attachment preview" className="max-h-52 rounded-card border border-line object-contain" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => setImage(null)}
                className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-muted shadow-soft hover:text-risk"
              >
                <X size={13} />
              </button>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-btn border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-2"
            >
              <ImagePlus size={14} /> {image ? "Change image" : "Add image"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0])} />
            <span className="ml-auto flex items-center gap-3">
              <FormError message={postError} />
              <SubmitButton>Post</SubmitButton>
            </span>
          </div>
        </form>
      )}

      {posts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(["ALL", ...CATEGORIES.map((c) => c.key)] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key as GnPostCategoryKey | "ALL")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === key ? "border-transparent bg-accent text-white" : "border-line-strong text-muted hover:text-ink"
              }`}
            >
              {key === "ALL" ? "All" : categoryOf(key as GnPostCategoryKey).label}
            </button>
          ))}
        </div>
      )}

      {posts.length === 0 && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm text-muted">
          No posts yet — be the first to say hallo! 👋
        </p>
      )}
      {posts.length > 0 && visible.length === 0 && (
        <p className="rounded-card border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-sm text-muted">
          Nothing in {categoryOf(filter as GnPostCategoryKey).label} yet.
        </p>
      )}

      {visible.map((post) => (
        <article
          key={post.id}
          className={`rounded-card border bg-surface p-4 shadow-card ${post.pinned ? "border-[var(--lvl-gn)]" : "border-line"}`}
        >
          {post.pinned && (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--lvl-gn)]">
              <Pin size={12} /> Pinned
            </p>
          )}
          <div className="flex items-start gap-3">
            <Avatar name={post.authorName} image={post.authorImage} level={post.authorLevel} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm">
                  <span className="font-semibold text-ink">{post.authorName ?? "Former member"}</span>
                  <RoleChip role={post.authorRole} />
                  <span className="ml-2 text-xs text-muted">{timeAgo(post.createdAt)}</span>
                </p>
                <CategoryChip category={post.category} />
              </div>
              {post.title && <h3 className="mt-1 font-display text-[15px] font-semibold text-ink">{post.title}</h3>}
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink-2">
                <MentionText body={post.body} candidates={candidates} />
              </p>
              {post.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.imageUrl} alt="" className="mt-3 max-h-96 rounded-card border border-line object-contain" />
              )}

              <div className="mt-3 flex items-center gap-4 text-xs text-muted">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 font-medium transition-colors ${post.likedByMe ? "text-risk" : "hover:text-ink"}`}
                  onClick={async () => {
                    const res = await toggleGnLike(post.id);
                    if (!res.ok) return toast(res.error, "error");
                    refresh();
                  }}
                >
                  <Heart size={14} fill={post.likedByMe ? "currentColor" : "none"} />
                  {post.likeCount > 0 && <span className="tnum">{post.likeCount}</span>}
                  <span className="sr-only">{post.likedByMe ? "Unlike" : "Like"}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 font-medium hover:text-ink"
                  onClick={() => setOpenComments((s) => ({ ...s, [post.id]: !s[post.id] }))}
                >
                  <MessageCircle size={14} />
                  {post.comments.length > 0 ? `${post.comments.length}` : "Comment"}
                </button>
                <span className="ml-auto inline-flex items-center gap-3">
                  {post.canPin && (
                    <button
                      type="button"
                      aria-label={post.pinned ? "Unpin post" : "Pin post"}
                      title={post.pinned ? "Unpin" : "Pin to top"}
                      className="inline-flex items-center gap-1 font-medium hover:text-ink"
                      onClick={async () => {
                        const res = await toggleGnPin(post.id);
                        if (!res.ok) return toast(res.error, "error");
                        toast(post.pinned ? "Unpinned" : "Pinned to top");
                        refresh();
                      }}
                    >
                      {post.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                  )}
                  {post.canDelete && (
                    <button
                      type="button"
                      aria-label="Delete post"
                      className="inline-flex items-center gap-1 font-medium hover:text-risk"
                      onClick={async () => {
                        const ok = await askConfirm({
                          title: "Delete this post?",
                          body: "Its comments and likes are removed too.",
                          confirmLabel: "Delete",
                          danger: true,
                        });
                        if (!ok) return;
                        const res = await deleteGnPost(post.id);
                        if (!res.ok) return toast(res.error, "error");
                        toast("Post deleted");
                        refresh();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>

              {(post.comments.length > 0 || openComments[post.id]) && (
                <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                  {post.comments.map((c) => (
                    <CommentRow key={c.id} c={c} candidates={candidates} canPost={canPost} onChanged={refresh} />
                  ))}
                  {canPost && openComments[post.id] && <CommentBox postId={post.id} candidates={candidates} onDone={refresh} />}
                  {canPost && !openComments[post.id] && post.comments.length > 0 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => setOpenComments((s) => ({ ...s, [post.id]: true }))}
                    >
                      Reply…
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
