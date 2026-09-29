import "server-only";

import { prisma } from "@/lib/prisma";
import type { Block } from "@/lib/sites-types";

/** Read layer for the section library and the page templates - both are `SectionSnippet` rows. */

export type SnippetRow = {
  id: string;
  name: string;
  category: string;
  scope: "SECTION" | "PAGE";
  blocks: Block[];
  builtIn: boolean;
  /** How many top-level nodes come in - shown in the picker so a "section" that is really a
   *  whole page is not a surprise after it lands. */
  nodeCount: number;
};

const UNFILED = "Saved by the team";

export async function getSnippets(): Promise<SnippetRow[]> {
  const rows = await prisma.sectionSnippet.findMany({
    // Built-ins first, then the team's own, each alphabetically. Recency ordering was tempting
    // and wrong: a library you scan by eye needs items to stay where they were last time.
    orderBy: [{ builtIn: "desc" }, { category: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => {
    const blocks = (r.blocks as Block[]) ?? [];
    return {
      id: r.id,
      name: r.name,
      category: r.category?.trim() || UNFILED,
      scope: r.scope,
      blocks,
      builtIn: r.builtIn,
      nodeCount: blocks.length,
    };
  });
}

/** The categories currently in use, for the "save to…" field's suggestions. */
export function snippetCategories(rows: SnippetRow[]): string[] {
  return [...new Set(rows.map((r) => r.category))].sort();
}
