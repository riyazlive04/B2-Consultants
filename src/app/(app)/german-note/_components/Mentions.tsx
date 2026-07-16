"use client";

import { useId, useRef, useState, type ReactNode } from "react";
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
          // program colour is an identity TINT, not a text colour (§8 a11y): keep
          // the teal as a soft background and let the ink text carry the contrast.
          <span key={i} className="rounded bg-lvl-gn/10 px-0.5 font-semibold text-ink">
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
 *
 * Keyboard: the textarea keeps focus and drives the listbox — ↑/↓ move the active
 * option, Enter selects it, Esc dismisses. The options are real buttons too, so a
 * mouse click (onMouseDown, which must preventDefault to stop the textarea
 * blurring) and a native button activation (onClick → Enter/Space) both select.
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
  const [activeIndex, setActiveIndex] = useState(0);
  const anchorRef = useRef<number>(-1); // index of the '@' being completed
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

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
    setActiveIndex(0);
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

  const open = matches.length > 0;

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
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        className={fieldCls}
        onInput={recompute}
        onClick={recompute}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const c = matches[activeIndex];
            if (c) pick(c);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setMatches([]);
          }
        }}
        onKeyUp={(e) => {
          // navigation/selection keys are handled in onKeyDown; recomputing here
          // would reset the active option and undo arrow navigation
          if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) return;
          recompute();
        }}
        onBlur={() => setTimeout(() => setMatches([]), 150)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-52 w-full max-w-xs overflow-auto rounded-field border border-line-strong bg-surface p-1 shadow-card"
        >
          {matches.map((c, i) => (
            <li key={c.id} role="presentation">
              <button
                type="button"
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-sm ${
                  i === activeIndex ? "bg-surface-2" : "hover:bg-surface-2"
                }`}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-lvl-gn/10 text-caption font-bold text-ink">
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
