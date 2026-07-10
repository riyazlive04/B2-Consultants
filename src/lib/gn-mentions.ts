/**
 * @mentions for the German Note community. Isomorphic: the server resolves
 * `@Name` tokens to user ids (for notifications), the client uses the same
 * candidate list to highlight mentions and power the composer autocomplete.
 * Names can contain spaces, so we match the full display name after `@`.
 */

export type MentionCandidate = { id: string; name: string };

/** Resolve `@Full Name` tokens in `body` to user ids, longest name first. */
export function parseMentions(body: string, candidates: MentionCandidate[]): string[] {
  const hay = body.toLowerCase();
  const ids = new Set<string>();
  // longest names first so "@Anna Schmidt" isn't shadowed by "@Anna"
  for (const c of [...candidates].sort((a, b) => b.name.length - a.name.length)) {
    if (c.name && hay.includes(`@${c.name.toLowerCase()}`)) ids.add(c.id);
  }
  return [...ids];
}

/**
 * Split `body` into segments, marking runs that are `@Name` for a known
 * candidate. Returns plain text + mention segments so the UI can style them
 * without dangerouslySetInnerHTML.
 */
export type MentionSegment = { text: string; mention: boolean };

export function segmentMentions(body: string, candidates: MentionCandidate[]): MentionSegment[] {
  const names = [...candidates]
    .map((c) => c.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: body, mention: false }];

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(?:${escaped.join("|")})`, "gi");
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ text: body.slice(last, start), mention: false });
    segments.push({ text: m[0], mention: true });
    last = start + m[0].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last), mention: false });
  return segments.length ? segments : [{ text: body, mention: false }];
}
