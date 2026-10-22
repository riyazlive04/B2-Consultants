/**
 * HTML → `DocBlock[]`. Pure, isomorphic, no DOM, no dependencies.
 *
 * ── WHERE THE HTML COMES FROM ───────────────────────────────────────────────────────────────
 * TWO places now, and the second is the reason this file has to be forgiving:
 *
 *   1. `server/agreement-docx.ts` runs mammoth over an uploaded `.docx`.
 *   2. The document EDITOR hands back whatever `contenteditable` produced - `<div>`s where
 *      paragraphs were, `<font>` tags, inline styles, nested spans, and a `<b>` where a `<strong>`
 *      went in. That is not a browser bug, it is what contenteditable does.
 *
 * Everything unrecognised is dropped either way, which is exactly what makes the editor safe:
 * every keystroke eventually passes through here, so the stored document can only ever contain
 * shapes the PDF renderer has been taught to draw. See `lib/blocks-html.ts` for the inverse.
 *
 * `server/agreement-docx.ts` runs mammoth over an uploaded `.docx`. Mammoth emits a small, well
 * formed subset - `p`, `h1`-`h6`, `strong`, `em`, `u`, `ul`/`ol`/`li`, `table`/`tr`/`td`/`th`,
 * `br`, `a`, `img`, `sup`, `sub` - which is why a scanner of this size is the right tool here and
 * a full HTML5 parser (or a DOM in Node) is not. It is also why this file refuses to be a general
 * sanitizer: everything it does not recognise is DROPPED, structure and all.
 *
 * That default is the security property. The output can only ever contain the block and inline
 * shapes `lib/agreement-doc` defines, so there is no path from an uploaded file to a script, a
 * style, an iframe or an unbounded nesting depth - the renderer downstream only knows how to
 * typeset text runs.
 *
 * ── WHAT IS DELIBERATELY LOST ───────────────────────────────────────────────────────────────
 * Images, fonts, colours, column widths, headers/footers and page geometry. A DOCX agreement is
 * re-typeset in B2's own document style, not reproduced; the founder who needs Word's exact
 * layout uploads a PDF instead (see docs/AGREEMENT_DOCUMENTS_REBUILD.md). `dropped` reports what
 * went, so the upload screen can say so rather than letting the founder discover it in the
 * preview.
 *
 * PAGE BREAKS go with them, and that one is worth stating because it looks like a bug: mammoth
 * converts to SEMANTIC html and a page break is presentational, so nothing reaches this parser to
 * turn into a `pageBreak` block. Word's pagination is meaningless once the document is re-typeset
 * anyway - breaks are added in the editor afterwards, and the renderer honours those.
 *
 * ── SIGNATURE PLACEHOLDERS ──────────────────────────────────────────────────────────────────
 * `[[sign:student]]` typed in Word becomes a field block plus the field behind it. This is the
 * "specify a section of the document to be signed" half of the feature done the way a Word user
 * would expect: mark it up where you are already writing, rather than hunting for the spot again
 * in a web editor afterwards.
 */

import {
  nextFieldId,
  type DocAlign,
  type DocBlock,
  type DocField,
  type DocInline,
  type FieldKind,
  type SignerRole,
} from "./agreement-doc";

// ───────────────────────────── Placeholders ─────────────────────────────

/**
 * `[[sign:student]]`, `[[date:creator]]`, `[[text:creator|Programme name]]`.
 *
 * EVERY field kind the designer can place is writable here too. That is the point of the syntax:
 * a founder who marks up the whole document in Word should never have to come back to the designer
 * to add the one kind the parser forgot about.
 *
 * Longer alternatives are listed FIRST (`signature` before `sign`, `initials` before `initial`).
 * The regex engine does backtrack, so a shorter-first order happens to work - but it works by
 * failing and retrying, and the order below says what is meant.
 */
const PLACEHOLDER_RE =
  /\[\[\s*(signature|sign|initials|initial|date|name|text|checkbox|check|attachment|attach|file)\s*:\s*(creator|b2|coach|guardian|parent|witness|student|client)\s*(?:\|([^\]]{0,60}))?\s*\]\]/gi;

const KIND_ALIASES: Record<string, FieldKind> = {
  sign: "SIGNATURE",
  signature: "SIGNATURE",
  initial: "INITIALS",
  initials: "INITIALS",
  date: "DATE",
  name: "NAME",
  text: "TEXT",
  check: "CHECKBOX",
  checkbox: "CHECKBOX",
  attach: "ATTACHMENT",
  attachment: "ATTACHMENT",
  file: "ATTACHMENT",
};

const SIGNER_ALIASES: Record<string, SignerRole> = {
  creator: "CREATOR",
  b2: "CREATOR",
  coach: "CREATOR",
  guardian: "GUARDIAN",
  parent: "GUARDIAN",
  witness: "GUARDIAN",
  student: "STUDENT",
  client: "STUDENT",
};

/** The markup a founder can type in Word, for the help text on the upload screen. */
export const PLACEHOLDER_HELP = [
  "[[sign:creator]] - where B2 Consultants signs",
  "[[sign:student]] - where the student signs",
  "[[date:student]] - the date they signed",
  "[[name:student]] - their printed name",
  "[[initials:student]] - a small initials box",
  "[[check:student|I have read section 8]] - a tick box they must agree to",
  "[[text:student|Passport number]] - a box THEY fill in as they sign",
  "[[file:student|Photo ID]] - ask them to upload a file",
  "[[text:creator|Label]] - a box YOU fill in while drafting",
  "[[sign:guardian]] - a parent or guardian who signs before the student",
] as const;

// ───────────────────────────── Result ─────────────────────────────

export type ParsedDoc = {
  blocks: DocBlock[];
  /** Fields created from `[[...]]` placeholders, in document order. */
  fields: DocField[];
  /** What was thrown away, counted by kind, so the UI can be honest about it. */
  dropped: { images: number; unsupported: number };
};

// ───────────────────────────── Tokenizer ─────────────────────────────

type Token =
  | { t: "text"; value: string }
  | { t: "open"; name: string; attrs: string }
  | { t: "close"; name: string }
  | { t: "void"; name: string; attrs: string };

const VOID_TAGS = new Set(["br", "img", "hr", "col", "input", "meta", "link"]);

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  // Comments, and anything that could carry executable content, go before tags are even read:
  // a `<script>` body is TEXT to a tag scanner, so it must be removed wholesale, not skipped.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "");

  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let last = 0;
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    if (m.index > last) out.push({ t: "text", value: cleaned.slice(last, m.index) });
    const raw = m[0]!;
    const name = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    if (raw.startsWith("</")) out.push({ t: "close", name });
    else if (raw.endsWith("/>") || VOID_TAGS.has(name)) out.push({ t: "void", name, attrs });
    else out.push({ t: "open", name, attrs });
    last = re.lastIndex;
  }
  if (last < cleaned.length) out.push({ t: "text", value: cleaned.slice(last) });
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  sect: "§",
  euro: "€",
  bull: "•",
};

/**
 * Decode entities, and ONLY the ones a Word export produces plus numeric references.
 *
 * `&nbsp;` becomes a plain space deliberately: react-pdf treats U+00A0 as unbreakable, and a
 * Word document is full of them - a run of three in a justified paragraph is enough to push a
 * line past the measure.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Collapse runs of whitespace, as HTML does. Newlines we inserted for `<br>` survive. */
function collapse(s: string): string {
  return s.replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n");
}

// ───────────────────────────── Parser ─────────────────────────────

const PARA_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div"]);
const STRUCTURE_TAGS = new Set([...PARA_TAGS, "li", "td", "th", "tr", "table", "ul", "ol"]);

/**
 * ── THE ONE THING TO UNDERSTAND BEFORE EDITING ──────────────────────────────────────────────
 * Mammoth nests paragraphs inside cells: `<td><p>Fee</p><p>69,999</p></td>`. So "which container
 * am I in" cannot be a single value that `<p>` overwrites - it has to be a priority order. A cell,
 * while open, SWALLOWS everything: a `<p>` inside it contributes a line break, not a block of its
 * own. Treating `<p>` as authoritative instead is how you get a table whose cells are empty and
 * whose text has escaped into the document above it.
 */
export function htmlToBlocks(html: string): ParsedDoc {
  const tokens = tokenize(html);
  const blocks: DocBlock[] = [];
  const fields: DocField[] = [];
  const dropped = { images: 0, unsupported: 0 };

  const marks = { b: 0, i: 0, u: 0, href: null as string | null };
  let runs: DocInline[] = [];

  /** The open containers, in priority order: a cell beats a list item beats a paragraph. */
  let cell: { head: boolean } | null = null;
  let listItem = false;
  let paraTag: string | null = null;
  let paraAlign: DocAlign | null = null;

  /**
   * How deep we are inside an ATOMIC WIDGET - a signature zone or a page break from the editor.
   *
   * Its contents are a caption the editor drew for the human; the block model keeps only the
   * field id. So the widget's children are skipped wholesale rather than parsed as prose, which
   * is what stops "B2 Consultants · signature" appearing in the contract as a paragraph.
   */
  let skipDepth = 0;

  const listStack: { ordered: boolean; items: DocInline[][] }[] = [];
  let table: { rows: { head?: boolean; cells: DocInline[][] }[] } | null = null;
  let row: { head?: boolean; cells: DocInline[][] } | null = null;

  const pushRun = (text: string) => {
    if (!text) return;
    const run: DocInline = { text };
    if (marks.b > 0) run.b = true;
    if (marks.i > 0) run.i = true;
    if (marks.u > 0) run.u = true;
    if (marks.href) run.href = marks.href;
    const prev = runs[runs.length - 1];
    // Merge adjacent runs with identical marks - Word emits a <strong> per word surprisingly often.
    if (prev && !!prev.b === !!run.b && !!prev.i === !!run.i && !!prev.u === !!run.u && prev.href === run.href) {
      prev.text += run.text;
      return;
    }
    runs.push(run);
  };

  /** Drain the buffer, trimming the paragraph's own edges but not the marks inside it. */
  const takeRuns = (): DocInline[] => {
    const out = runs.filter((r) => r.text !== "");
    runs = [];
    if (out.length > 0) {
      out[0]!.text = out[0]!.text.replace(/^[ \n]+/, "");
      out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/[ \n]+$/, "");
    }
    return out.filter((r) => r.text !== "");
  };

  /** Emit the buffer as blocks, splitting out any `[[...]]` placeholder into its own field block. */
  const emitParagraph = (tag: string | null) => {
    const collected = takeRuns();
    if (collected.length === 0) return;
    const heading = tag ? /^h([1-6])$/.exec(tag) : null;
    for (const piece of splitPlaceholders(collected, fields)) {
      if (piece.kind === "field") {
        blocks.push({ type: "field", fieldId: piece.fieldId });
      } else if (heading) {
        // h4-h6 all land on level 3: the renderer has three heading sizes, and inventing a
        // fourth to honour a Word outline level nobody can see is not worth the typography.
        const n = Math.min(3, Number(heading[1])) as 1 | 2 | 3;
        blocks.push({ type: "heading", level: n, runs: piece.runs });
      } else {
        const paragraph: Extract<DocBlock, { type: "p" }> = { type: "p", runs: piece.runs };
        // Absent when it is the default, so a document that never used alignment hashes as it did.
        if (paraAlign && paraAlign !== "left") paragraph.align = paraAlign;
        blocks.push(paragraph);
      }
    }
  };

  /** A paragraph boundary INSIDE a cell or a list item: a line break, never a new block. */
  const softBreak = () => {
    if (runs.length > 0 && !runs[runs.length - 1]!.text.endsWith("\n")) pushRun("\n");
  };

  const closeParagraph = () => {
    if (cell || listItem) {
      softBreak();
      paraTag = null;
      return;
    }
    emitParagraph(paraTag);
    paraTag = null;
    paraAlign = null;
  };

  const closeListItem = () => {
    const item = takeRuns();
    const list = listStack[listStack.length - 1];
    if (list) {
      if (item.length > 0) list.items.push(item);
    } else if (item.length > 0) {
      blocks.push({ type: "p", runs: item }); // an <li> with no list around it is still prose
    }
    listItem = false;
  };

  const closeCell = () => {
    const collected = takeRuns();
    if (row) {
      row.cells.push(collected);
      if (cell?.head) row.head = true;
    } else if (collected.length > 0) {
      blocks.push({ type: "p", runs: collected });
    }
    cell = null;
  };

  /** Close whatever is open, innermost first. Called before any structural tag opens. */
  const closeOpen = () => {
    if (cell) return closeCell();
    if (listItem) return closeListItem();
    if (paraTag !== null) return closeParagraph();
    runs = []; // loose text between structures
  };

  const closeList = () => {
    const list = listStack.pop();
    if (!list || list.items.length === 0) return;
    const parent = listStack[listStack.length - 1];
    if (parent) {
      // A nested list has nowhere to go in a flat model, so its items join the parent marked
      // with a hyphen - the same way the guided templates set sub-bullets, and for the same
      // reason: "◦" is absent from WinAnsi and prints as a blank box.
      for (const item of list.items) parent.items.push([{ text: "- " }, ...item]);
      return;
    }
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
  };

  const closeTable = () => {
    if (!table) return;
    if (row) {
      table.rows.push(row);
      row = null;
    }
    if (table.rows.length > 0) blocks.push({ type: "table", rows: table.rows });
    table = null;
  };

  for (const tk of tokens) {
    /**
     * Inside an atomic widget, nothing counts except finding the end of it. Depth-tracked rather
     * than "skip to the next close tag", because a widget contains elements of its own.
     */
    if (skipDepth > 0) {
      if (tk.t === "open") skipDepth++;
      else if (tk.t === "close") skipDepth--;
      continue;
    }

    if (tk.t === "text") {
      const text = collapse(decodeEntities(tk.value));
      // Text outside any container still belongs to the document - Word wraps everything, but a
      // hand-edited HTML upload might not, and silently dropping prose is never right.
      if (!cell && !listItem && paraTag === null && text.trim()) paraTag = "p";
      pushRun(text);
      continue;
    }

    if (tk.t === "void") {
      if (tk.name === "br") pushRun("\n");
      else if (tk.name === "img") dropped.images++;
      else if (tk.name === "hr") {
        closeOpen();
        blocks.push({ type: "rule" });
      }
      continue;
    }

    const open = tk.t === "open";
    const name = tk.name;

    /**
     * ── ATOMIC WIDGETS FROM THE EDITOR ──
     * Matched on the DATA ATTRIBUTE, never on the tag or the class. contenteditable rewrites tags
     * and browsers mangle class lists, but an unknown `data-` attribute is carried through
     * untouched by every engine - so this is the one part of the markup that can be relied on
     * after a round trip through a page somebody has been typing in.
     */
    if (open && tk.t === "open") {
      const fieldId = attrOf(tk.attrs, "data-field-id");
      if (fieldId) {
        closeOpen();
        blocks.push({ type: "field", fieldId: fieldId.slice(0, 40) });
        skipDepth = 1;
        continue;
      }
      if (attrOf(tk.attrs, "data-page-break")) {
        closeOpen();
        blocks.push({ type: "pageBreak" });
        skipDepth = 1;
        continue;
      }
    }

    // ── Inline marks ──
    switch (name) {
      case "strong":
      case "b":
        marks.b = Math.max(0, marks.b + (open ? 1 : -1));
        continue;
      case "em":
      case "i":
        marks.i = Math.max(0, marks.i + (open ? 1 : -1));
        continue;
      case "u":
      case "ins":
        marks.u = Math.max(0, marks.u + (open ? 1 : -1));
        continue;
      case "a":
        marks.href = open && tk.t === "open" ? hrefOf(tk.attrs) : null;
        continue;
      case "span":
      case "small":
      case "mark":
      case "font":
      case "sup":
      case "sub":
        continue; // marks we do not model; the text inside is kept
      default:
        break;
    }

    // ── Structure ──
    if (PARA_TAGS.has(name)) {
      if (open) {
        if (cell || listItem) softBreak();
        else closeOpen();
        paraTag = name === "blockquote" || name === "div" ? "p" : name;
        paraAlign = tk.t === "open" ? alignOf(tk.attrs) : null;
      } else {
        closeParagraph();
      }
      continue;
    }

    switch (name) {
      case "ul":
      case "ol":
        // Inside a cell the list structure is abandoned on the way in, not reconciled on the way
        // out: the model has no list-inside-a-table, and the runs buffer belongs to the cell. The
        // items become hyphenated lines in that cell (see the `li` case).
        if (cell) break;
        if (open) {
          closeOpen();
          listStack.push({ ordered: name === "ol", items: [] });
        } else {
          if (listItem) closeListItem();
          closeList();
        }
        break;

      case "li":
        if (cell) {
          if (open) {
            softBreak();
            pushRun("- ");
          }
          break;
        }
        if (open) {
          closeOpen();
          listItem = true;
        } else {
          closeListItem();
        }
        break;

      case "table":
        if (open) {
          closeOpen();
          if (!table) table = { rows: [] };
          else dropped.unsupported++; // a nested table: its cells flatten into the outer one
        } else {
          closeOpen();
          closeTable();
        }
        break;

      case "tr":
        if (open) {
          closeOpen();
          if (table && row) table.rows.push(row);
          row = { cells: [] };
        } else {
          closeOpen();
          if (table && row) {
            table.rows.push(row);
            row = null;
          }
        }
        break;

      case "td":
      case "th":
        if (open) {
          closeOpen();
          cell = { head: name === "th" };
        } else {
          closeCell();
        }
        break;

      default:
        if (open && !STRUCTURE_TAGS.has(name)) dropped.unsupported++;
        break;
    }
  }

  // Anything still open at EOF - an unclosed <p>, a truncated table - is emitted, never lost.
  closeOpen();
  while (listStack.length > 0) closeList();
  closeTable();

  return { blocks, fields, dropped };
}

/** Read one attribute's value out of a raw tag's attribute string. */
function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  const value = m?.[2] ?? m?.[3] ?? m?.[4] ?? null;
  return value === null ? null : decodeEntities(value).trim();
}

/**
 * The alignment a browser puts on a block when somebody presses the centre button.
 *
 * `execCommand("justifyCenter")` writes `style="text-align: center;"`; older engines and pasted
 * Word HTML use `align="center"`. Both are read, because the alternative is a founder centring a
 * heading and watching it jump back on save.
 */
function alignOf(attrs: string): DocAlign | null {
  const style = attrOf(attrs, "style") ?? "";
  const m = /text-align\s*:\s*(left|right|center|justify)/i.exec(style);
  const value = (m?.[1] ?? attrOf(attrs, "align") ?? "").toLowerCase();
  return value === "left" || value === "right" || value === "center" || value === "justify"
    ? (value as DocAlign)
    : null;
}

function hrefOf(attrs: string): string | null {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const value = m?.[2] ?? m?.[3] ?? m?.[4] ?? null;
  if (!value) return null;
  const href = decodeEntities(value).trim();
  // http(s) and mailto only. A `javascript:` or `data:` href would never execute in a PDF, but
  // it WOULD be printed on a contract, and the editor shows it too.
  return /^(https?:|mailto:)/i.test(href) ? href.slice(0, 500) : null;
}

// ───────────────────────────── Placeholder splitting ─────────────────────────────

type Piece = { kind: "runs"; runs: DocInline[] } | { kind: "field"; fieldId: string };

/**
 * Cut `[[sign:student]]` out of a paragraph's runs, turning the paragraph into
 * (text before) + (field) + (text after). `fields` is mutated so ids stay sequential across the
 * whole document - see `nextFieldId` on why they must not be random.
 */
function splitPlaceholders(source: DocInline[], fields: DocField[]): Piece[] {
  const pieces: Piece[] = [];
  let buffer: DocInline[] = [];

  const flush = () => {
    const kept = buffer.filter((r) => r.text.trim() !== "" || r.text.includes("\n"));
    if (kept.length > 0) {
      // Each piece becomes a paragraph of its own, so it is trimmed like one: the space that was
      // sitting beside the placeholder in Word would otherwise open the new paragraph.
      kept[0] = { ...kept[0]!, text: kept[0]!.text.replace(/^[ \n]+/, "") };
      const lastIndex = kept.length - 1;
      kept[lastIndex] = { ...kept[lastIndex]!, text: kept[lastIndex]!.text.replace(/[ \n]+$/, "") };
      const trimmed = kept.filter((r) => r.text !== "");
      if (trimmed.length > 0) pieces.push({ kind: "runs", runs: trimmed });
    }
    buffer = [];
  };

  for (const run of source) {
    PLACEHOLDER_RE.lastIndex = 0;
    if (!PLACEHOLDER_RE.test(run.text)) {
      buffer.push(run);
      continue;
    }
    PLACEHOLDER_RE.lastIndex = 0;
    let cursor = 0;
    for (let m = PLACEHOLDER_RE.exec(run.text); m; m = PLACEHOLDER_RE.exec(run.text)) {
      const before = run.text.slice(cursor, m.index);
      if (before) buffer.push({ ...run, text: before });
      flush();

      const kind = KIND_ALIASES[m[1]!.toLowerCase()]!;
      const signer = SIGNER_ALIASES[m[2]!.toLowerCase()]!;
      const label = m[3]?.trim();
      const field: DocField = { id: nextFieldId(fields), kind, signer };
      if (label) field.label = label.slice(0, 60);
      fields.push(field);
      pieces.push({ kind: "field", fieldId: field.id });

      cursor = m.index + m[0]!.length;
    }
    const after = run.text.slice(cursor);
    if (after) buffer.push({ ...run, text: after });
  }

  flush();
  return pieces;
}
