"use client";

import { useRef, useState, type ReactNode } from "react";
import { segmentMentions, type MentionCandidate } from "@/lib/gn-mentions";

const fieldCls =
  "w-full rounded-field border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary-soft";

/** Render post/comment text with @mentions highlighted (no HTML injection). */
export function MentionText({ body, candidates }: { body: string; candidates: MentionCandidate[] }): ReactNode {
  const segments = segmentMentions(body, candidates);
  return (
    <>
      {segments.map((s, i) =>
        s.mention ? (
          <span key={i} className="font-semibold text-[var(--lvl-gn)]">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

/**
 * Uncontrolled textarea (so <form> reset works) with an @mention autocomplete.
 * Typing `@` then a name filters the batch/community members; picking one
 * inserts the full display name.
 */
export function MentionTextArea({
  name,
  candidates,
  rows = 3,
  placeholder,
  required,
  maxLength,
  ariaLabel,
}: {
  name: string;
  candidates: MentionCandidate[];
  rows?: number;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [matches, setMatches] = useState<MentionCandidate[]>([]);
  const anchorRef = useRef<number>(-1); // index of the '@' being completed

  const recompute = () => {
    const el = ref.current;
    if (!el) return setMatches([]);
    const caret = el.selectionStart ?? el.value.length;
    const upto = el.value.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at === -1) return setMatches([]);
    const query = upto.slice(at + 1);
    // a mention query can't span lines and stays short
    if (query.includes("\n") || query.length > 40) return setMatches([]);
    anchorRef.current = at;
    const q = query.toLowerCase();
    const found = candidates.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 6);
    setMatches(found);
  };

  const pick = (c: MentionCandidate) => {
    const el = ref.current;
    if (!el || anchorRef.current < 0) return;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, anchorRef.current);
    const after = el.value.slice(caret);
    const insert = `@${c.name} `;
    el.value = `${before}${insert}${after}`;
    const pos = before.length + insert.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    setMatches([]);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        name={name}
        rows={rows}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className={fieldCls}
        onInput={recompute}
        onClick={recompute}
        onKeyUp={(e) => {
          if (e.key === "Escape") return setMatches([]);
          recompute();
        }}
        onBlur={() => setTimeout(() => setMatches([]), 150)}
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-52 w-full max-w-xs overflow-auto rounded-field border border-line-strong bg-surface p-1 shadow-card">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#3fc0b722] text-[10px] font-bold text-[var(--lvl-gn)]">
                  {c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
