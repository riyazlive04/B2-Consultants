import type { Block, BlockType } from "./sites-types";
import { isContainer } from "./sites-types";

/**
 * Pure tree operations over a page's node list.
 *
 * Kept apart from both the renderer and the editor because the visual canvas mutates the tree on
 * every interaction - select, drag, duplicate, delete, nudge - and doing that with ad-hoc
 * spread-and-splice inside a component is how a builder starts losing people's work. These are
 * total functions over an immutable tree: every one returns a NEW list, so undo is a stack of
 * previous roots rather than a diff to replay.
 *
 * A node's children can live in either `children` (the node model) or `columns` (rows authored
 * before it), so every walk here reads both and writes back the shape it found. That is the only
 * concession to the legacy shape; nothing above this file needs to know.
 */

export type Path = number[];

let seq = 0;
export function newNodeId(): string {
  return `n${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** Children of a node, whichever field holds them. */
export function childrenOf(b: Block): Block[] {
  if (b.children?.length) return b.children;
  if (b.columns?.length) return b.columns.flat();
  return b.children ?? [];
}

function withChildren(b: Block, kids: Block[]): Block {
  // Writing `children` and dropping `columns` migrates a legacy row the moment it is touched.
  return b.columns?.length ? { ...b, children: kids, columns: undefined } : { ...b, children: kids };
}

export function findNode(list: Block[], id: string): Block | null {
  for (const b of list) {
    if (b.id === id) return b;
    const hit = findNode(childrenOf(b), id);
    if (hit) return hit;
  }
  return null;
}

/** The chain of ancestors from the root down to (and excluding) the node. Drives the breadcrumb. */
export function findAncestors(list: Block[], id: string, trail: Block[] = []): Block[] | null {
  for (const b of list) {
    if (b.id === id) return trail;
    const hit = findAncestors(childrenOf(b), id, [...trail, b]);
    if (hit) return hit;
  }
  return null;
}

export function updateNode(list: Block[], id: string, patch: Partial<Block>): Block[] {
  return list.map((b) => {
    if (b.id === id) return { ...b, ...patch };
    const kids = childrenOf(b);
    return kids.length ? withChildren(b, updateNode(kids, id, patch)) : b;
  });
}

export function removeNode(list: Block[], id: string): Block[] {
  return list
    .filter((b) => b.id !== id)
    .map((b) => {
      const kids = childrenOf(b);
      return kids.length ? withChildren(b, removeNode(kids, id)) : b;
    });
}

/** Fresh ids throughout - a duplicate that reused ids would break selection and mobile CSS rules. */
export function cloneNode(b: Block): Block {
  const kids = childrenOf(b);
  const copy: Block = { ...b, id: newNodeId() };
  return kids.length ? withChildren(copy, kids.map(cloneNode)) : copy;
}

/**
 * Re-key a whole list of nodes - what every insert from the section library and every page
 * template goes through.
 *
 * Without it, dropping the same saved section onto a page twice produces two subtrees with
 * identical ids: selection would highlight both, the mobile-override `@media` rules would collide,
 * and deleting one would delete the other. The stored snippet keeps whatever ids it was saved
 * with; they are placeholders, and this is where they stop being shared.
 */
export function withFreshIds(list: Block[]): Block[] {
  return list.map(cloneNode);
}

/** Insert `node` immediately after `afterId`, wherever in the tree that is. */
export function insertAfter(list: Block[], afterId: string, node: Block): Block[] {
  const i = list.findIndex((b) => b.id === afterId);
  if (i >= 0) return [...list.slice(0, i + 1), node, ...list.slice(i + 1)];
  return list.map((b) => {
    const kids = childrenOf(b);
    return kids.length ? withChildren(b, insertAfter(kids, afterId, node)) : b;
  });
}

/** Append `node` as the last child of `parentId`. */
export function appendChild(list: Block[], parentId: string, node: Block): Block[] {
  return list.map((b) => {
    if (b.id === parentId) return withChildren(b, [...childrenOf(b), node]);
    const kids = childrenOf(b);
    return kids.length ? withChildren(b, appendChild(kids, parentId, node)) : b;
  });
}

/**
 * Move a node one slot within its OWN parent.
 *
 * Deliberately not across parents: "up" past the top of a column has no single obvious meaning
 * (out to the row? into the previous column?), and guessing would move someone's block somewhere
 * they did not ask for. Cross-container moves are drag-and-drop's job, where the target is
 * explicit.
 */
export function nudge(list: Block[], id: string, dir: -1 | 1): Block[] {
  const i = list.findIndex((b) => b.id === id);
  if (i >= 0) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
  return list.map((b) => {
    const kids = childrenOf(b);
    return kids.length ? withChildren(b, nudge(kids, id, dir)) : b;
  });
}

/**
 * Move `dragId` next to `targetId` - the drag-and-drop primitive.
 *
 * Refuses to drop a node inside itself. Without that check, dragging a section onto its own child
 * detaches the whole subtree from the root and the page silently loses everything in it.
 */
export function moveNode(list: Block[], dragId: string, targetId: string, mode: "before" | "after" | "inside"): Block[] {
  if (dragId === targetId) return list;
  const dragged = findNode(list, dragId);
  if (!dragged) return list;
  if (findNode(childrenOf(dragged), targetId)) return list;

  const without = removeNode(list, dragId);
  if (mode === "inside") return appendChild(without, targetId, dragged);
  if (mode === "after") return insertAfter(without, targetId, dragged);

  const insertBefore = (l: Block[]): Block[] => {
    const i = l.findIndex((b) => b.id === targetId);
    if (i >= 0) return [...l.slice(0, i), dragged, ...l.slice(i)];
    return l.map((b) => {
      const kids = childrenOf(b);
      return kids.length ? withChildren(b, insertBefore(kids)) : b;
    });
  };
  return insertBefore(without);
}

/** A new node of `type`, pre-filled so it is visible the moment it lands on the canvas. */
export function makeNode(type: BlockType): Block {
  const b: Block = { id: newNodeId(), type };
  switch (type) {
    case "section": return { ...b, background: "plain", children: [], style: { padding: [56, 0, 56, 0], maxWidth: 1080 } };
    case "row": return { ...b, children: [{ id: newNodeId(), type: "column", children: [] }, { id: newNodeId(), type: "column", children: [] }] };
    case "heading": return { ...b, text: "Headline", style: { align: "center" } };
    case "subheading": return { ...b, text: "Subheading", style: { align: "center" } };
    case "eyebrow": return { ...b, text: "LABEL", style: { align: "center" } };
    case "text": return { ...b, text: "Write something here.", style: { align: "center" } };
    case "bullets": return { ...b, items: ["First point", "Second point"], variant: "check" };
    case "button": return { ...b, label: "Apply now", href: "/book", variant: "primary", style: { align: "center" } };
    case "stat": return { ...b, text: "200+", label: "Students coached", style: { align: "center" } };
    case "pill": return { ...b, text: "NEW", tone: "amber", style: { align: "center" } };
    case "avatar": return { ...b, text: "AB", tone: "blue" };
    case "dot": return { ...b, tone: "blue" };
    case "spacer": return { ...b, size: 32 };
    case "html": return { ...b, html: "<!-- paste your embed here -->" };
    default: return isContainer(type) ? { ...b, children: [] } : b;
  }
}
