"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Columns3,
  Italic,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Redo2,
  Rows3,
  Scissors,
  Table,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { blocksToHtml, zoneHtml } from "@/lib/blocks-html";
import { htmlToBlocks } from "@/lib/docx-blocks";
import {
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type DocBlock,
  type DocField,
  type FieldKind,
} from "@/lib/agreement-doc";

/**
 * The document, as a page you type into.
 *
 * ── WHY contenteditable AND NOT A RICH-TEXT FRAMEWORK ───────────────────────────────────────
 * Because the hard part is already solved. `lib/docx-blocks` is a parser that reduces arbitrary
 * HTML to the handful of shapes the PDF renderer can draw, and it is tested against exactly the
 * mess a browser produces. Pairing it with `lib/blocks-html` gives a round trip that is proven to
 * be lossless, with no new dependency, no second document schema and no editor runtime to keep in
 * step with the renderer.
 *
 * The block model remains the ONLY thing saved. The browser owns the DOM while somebody types;
 * every keystroke eventually goes back through the parser, so what gets stored can never contain
 * a shape the renderer has not been taught.
 *
 * ── THE RULE THAT KEEPS THE CURSOR WHERE IT IS ──────────────────────────────────────────────
 * This component is UNCONTROLLED. The HTML is written into the element once, and React never
 * re-renders it from state afterwards. Feeding a contenteditable from state on every keystroke
 * destroys and rebuilds the DOM under the caret, which sends it to the start of the document on
 * every character - the single most common way this kind of editor is got wrong.
 *
 * ── WHAT USES execCommand, AND WHAT DOES NOT ───────────────────────────────────────────────
 * INLINE marks - bold, italic, underline, lists, alignment, undo/redo - go through
 * `document.execCommand`. It is deprecated but universally implemented, it maintains the native
 * undo stack (which nothing else can), and for these it simply works.
 *
 * INSERTING OUR OWN WIDGETS does not. `insertHTML` runs Chrome's sanitiser, which strips
 * `contenteditable="false"` and the `data-` attributes a zone is identified by - the widget went
 * in and came back as plain text, so inserting one appeared to do nothing. Those go in through
 * the DOM instead, which is a pure insertion between blocks and leaves existing structure alone.
 *
 * ── WHAT WAS TRIED AND REVERTED, SO IT IS NOT TRIED AGAIN ───────────────────────────────────
 * Changing a paragraph into a heading was briefly done by hand too - build the new element, move
 * the children across, `replaceWith`. It worked in isolation and corrupted the document in use:
 * Chrome's editing engine keeps internal state about the block the caret is in, and replacing
 * that element out from under it leaves the state stale. The next `insertUnorderedList` then
 * merged a heading, a list item and a neighbouring paragraph into one `<li>` nested inside a
 * `<p>`. Structure is the browser's to change; `formatBlock` is how you ask.
 *
 * Which is why the style control is a MENU OF BUTTONS rather than a native `<select>`: a button
 * can suppress the focus change on mousedown and leave the caret where it is, and a select
 * cannot. The caret is also saved on every selection change and restored before any command, as
 * a second line of defence.
 *
 * ── SIGNATURE ZONES ARE ATOMIC ──────────────────────────────────────────────────────────────
 * Each is `contenteditable="false"`, so the browser treats it as one character: it cannot be
 * typed into, half-deleted or split by pressing Enter. It is matched on `data-field-id` rather
 * than its tag or class, because those are the parts a browser feels free to rewrite.
 */

export function DocumentCanvas({
  blocks,
  fields,
  onBlocks,
  onAddField,
  onFocusField,
  selectedId,
  disabled,
}: {
  blocks: DocBlock[];
  fields: DocField[];
  onBlocks: (next: DocBlock[]) => void;
  /** Creates the field in the parent and returns it, so its id can be written into the page. */
  onAddField: (kind: FieldKind) => DocField;
  onFocusField: (fieldId: string) => void;
  selectedId: string | null;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  /**
   * The shape of the table the caret is in, or null when it is in ordinary prose.
   *
   * Kept in state rather than read on click so the row and column buttons can be DISABLED when
   * they do not apply - a toolbar that offers "add a row" everywhere and silently does nothing
   * in four places out of five is worse than one that shows where it works. The counts are here
   * because the block schema caps a table at `MAX_TABLE_COLUMNS` cells and `MAX_TABLE_ROWS`
   * rows: past those, `htmlToBlocks` would drop at the next save exactly what was just added.
   */
  const [table, setTable] = useState<{ rows: number; cols: number } | null>(null);
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRange = useRef<Range | null>(null);

  /**
   * The document's markup, computed ONCE and rendered by the SERVER.
   *
   * Injecting it from an effect instead - the obvious approach - left the page literally empty
   * until the client bundle had loaded and hydrated: about a second in development, and a blank
   * contract for anybody on a slow connection. Rendering it server-side also means the document
   * is readable with no JavaScript at all.
   */
  const initialHtml = useRef<string | null>(null);
  if (initialHtml.current === null) initialHtml.current = blocksToHtml(blocks, fields);

  /**
   * Handlers reached through a ref, because the element below is built once and never rebuilt -
   * a closure captured at mount would go stale the moment any prop changed.
   */
  const handlers = useRef({ sync: () => {}, syncNow: () => {}, onPaste: (_: React.ClipboardEvent) => {}, onClick: (_: React.MouseEvent) => {} });

  useEffect(() => {
    // Enter should make a paragraph, not a div. Harmless where unsupported.
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* Firefox throws on unknown commands; the default is already <p> there. */
    }
  }, []);

  /**
   * Editability is set on the DOM, not through a prop.
   *
   * The element is deliberately outside React's reconciliation (see `page` below), so a prop
   * would never be applied after mount. It also must not be a dependency of the memo: `disabled`
   * flips while a save is in flight, and rebuilding the element then would discard the very edits
   * being saved.
   */
  useEffect(() => {
    if (ref.current) ref.current.contentEditable = String(!disabled);
  }, [disabled]);

  /** Read the page back into the block model. Debounced - it runs on a settle, not a keystroke. */
  const sync = useCallback(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current);
    parseTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      onBlocks(htmlToBlocks(el.innerHTML).blocks);
    }, 350);
  }, [onBlocks]);

  /** Flush immediately - before the parent saves, and when focus leaves the page. */
  const syncNow = useCallback(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current);
    const el = ref.current;
    if (el) onBlocks(htmlToBlocks(el.innerHTML).blocks);
  }, [onBlocks]);

  useEffect(() => () => void (parseTimer.current && clearTimeout(parseTimer.current)), []);

  /** Which marks are on at the caret, so the toolbar reflects the text rather than guessing. */
  useEffect(() => {
    const read = () => {
      const el = ref.current;
      const selection = document.getSelection();
      if (!el || !el.contains(selection?.anchorNode ?? null)) return;

      /**
       * Remember where the caret was.
       *
       * The icon buttons guard the selection with `preventDefault` on mousedown, but a native
       * `<select>` cannot - opening the style menu moves focus and collapses the selection, so
       * `formatBlock` was being applied to nothing and headings silently did not happen. The
       * range is saved here and restored in `run`.
       */
      if (selection && selection.rangeCount > 0) savedRange.current = selection.getRangeAt(0).cloneRange();

      const state = (cmd: string) => {
        try {
          return document.queryCommandState(cmd);
        } catch {
          return false;
        }
      };
      /**
       * Resolved from the LIVE selection only. Unlike the mark states this must not fall back to
       * the saved range: that range is a snapshot, and after a row is deleted it can still point
       * at a cell that no longer exists - which would leave the table tools lit up over nothing.
       */
      const anchor = selection?.anchorNode;
      const from = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
      const host = from?.closest("td,th")?.closest("table") ?? null;
      setTable(host ? { rows: host.rows.length, cols: columnsOf(host) } : null);

      setMarks({
        bold: state("bold"),
        italic: state("italic"),
        underline: state("underline"),
        insertUnorderedList: state("insertUnorderedList"),
        insertOrderedList: state("insertOrderedList"),
        justifyCenter: state("justifyCenter"),
        justifyRight: state("justifyRight"),
        justifyFull: state("justifyFull"),
      });
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);

  /** Put the caret back where it was before the toolbar took focus. */
  const restoreSelection = () => {
    const el = ref.current;
    const range = savedRange.current;
    if (!el) return;
    el.focus();
    const selection = document.getSelection();
    if (!selection || !range || !el.contains(range.commonAncestorContainer)) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const run = (command: string, value?: string) => {
    if (disabled) return;
    restoreSelection();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* An unsupported command is a no-op, not a crash. */
    }
    sync();
  };

  /**
   * The top-level element the caret is inside - the paragraph, heading or list the user is in.
   *
   * It tries the LIVE selection first and falls back to the saved range, and the fallback is what
   * makes the style menu work at all: opening a native `<select>` collapses the selection, and
   * unlike the icon buttons a select cannot suppress that. Restoring the range usually brings it
   * back, but "usually" is not good enough for the control that turns a line into a heading - so
   * the block is resolved from whichever of the two is actually inside the editor.
   */
  const blockOf = (node: Node | null | undefined): HTMLElement | null => {
    const el = ref.current;
    if (!el || !node || !el.contains(node)) return null;
    let current: Node | null = node;
    while (current && current.parentNode !== el) current = current.parentNode;
    return (current as HTMLElement) ?? null;
  };

  const currentBlock = (): HTMLElement | null =>
    blockOf(document.getSelection()?.anchorNode) ??
    blockOf(savedRange.current?.commonAncestorContainer);

  /**
   * Put an element in at the caret, through the DOM.
   *
   * NOT `execCommand("insertHTML")`: Chrome sanitises what that inserts and strips exactly the
   * two things a zone is made of - `contenteditable="false"` and its `data-` attributes - so the
   * widget silently became plain text. Inserting the node ourselves also lets the caret be placed
   * deliberately afterwards rather than wherever the command happened to leave it.
   */
  const insertNodeAtCaret = (node: Node, after?: Node) => {
    const el = ref.current;
    if (!el || disabled) return;
    restoreSelection();

    const selection = document.getSelection();
    const block = currentBlock();

    if (block) {
      // After the block the caret is in - a zone belongs between paragraphs, never inside one.
      block.after(node);
      if (after) (node as ChildNode).after(after);
    } else {
      el.append(node);
      if (after) el.append(after);
    }

    // Leave the caret in the paragraph that follows, so typing carries on naturally.
    const landing = (after ?? node) as HTMLElement;
    if (selection && landing) {
      const range = document.createRange();
      range.selectNodeContents(landing);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange.current = range.cloneRange();
    }
    el.focus();
    syncNow();
  };

  const htmlToNode = (html: string): ChildNode => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    return wrap.firstChild!;
  };

  /**
   * Turn the block at the caret into a heading (or back into a paragraph).
   *
   * Through `formatBlock`, deliberately - see the note at the top of this file on what happened
   * when this manipulated the DOM itself.
   */
  const setBlockTag = (tag: string) => {
    run("formatBlock", `<${tag}>`);
  };

  /** Plain text at the caret - merge tokens and pasted prose. */
  const insertText = (text: string) => {
    if (disabled) return;
    restoreSelection();
    try {
      document.execCommand("insertText", false, text);
    } catch {
      /* ignored */
    }
    sync();
  };

  const addZone = (kind: FieldKind) => {
    const field = onAddField(kind);
    // A paragraph after the zone, so there is somewhere to carry on typing - otherwise a zone at
    // the end of the document traps the caret with no way back into the text.
    insertNodeAtCaret(htmlToNode(zoneHtml(field)), htmlToNode("<p><br></p>"));
    onFocusField(field.id);
  };

  /**
   * ── TABLES ────────────────────────────────────────────────────────────────────────────────
   *
   * Through the DOM, like the widgets and unlike the marks. `execCommand` has no table commands
   * at all - Chrome's are non-standard and Firefox has none - and these are plain structural
   * edits the editing engine holds no state about: inserting a `<tr>` cannot leave it pointing at
   * a stale block the way replacing the caret's own paragraph did.
   *
   * A cell holds INLINE content, exactly as `blocksToHtml` writes it: `<td><br></td>` for an
   * empty one, never `<td><p></p></td>`. A paragraph inside a cell comes back out of the parser
   * as a cell with nothing in it, because `<p>` closes the cell's run buffer.
   *
   * The table itself goes in as a TOP-LEVEL block through `insertNodeAtCaret`, so a table is
   * never nested inside another - the parser flattens a nested one and counts it as dropped.
   */

  /** Put the caret at the start of a cell, so a new row or column is immediately typeable. */
  const caretInto = (cell: HTMLElement) => {
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    savedRange.current = range.cloneRange();
    ref.current?.focus();
  };

  /** The cell the caret is in. Live selection first, saved range second - see `currentBlock`. */
  const currentCell = (): HTMLTableCellElement | null => {
    const el = ref.current;
    if (!el) return null;
    for (const node of [
      document.getSelection()?.anchorNode,
      savedRange.current?.commonAncestorContainer,
    ]) {
      if (!node || !el.contains(node)) continue;
      const from = node instanceof Element ? node : node.parentElement;
      const cell = from?.closest<HTMLTableCellElement>("td,th");
      if (cell && el.contains(cell)) return cell;
    }
    return null;
  };

  const emptyCell = (head: boolean) => {
    const cell = document.createElement(head ? "th" : "td");
    cell.appendChild(document.createElement("br"));
    return cell;
  };

  /** Run a structural edit on the caret's table, then read the page back into the block model. */
  const tableOp = (fn: (cell: HTMLTableCellElement, host: HTMLTableElement) => void) => {
    if (disabled) return;
    const cell = currentCell();
    const host = cell?.closest("table");
    if (!cell || !host) return;
    fn(cell, host);
    syncNow();
  };

  const insertTable = () => {
    const host = document.createElement("table");
    const body = document.createElement("tbody");
    // A header row and one body row: the smallest table that still shows what a header row is
    // for. Rows and columns are added from the toolbar from there.
    for (const head of [true, false]) {
      const row = document.createElement("tr");
      row.append(emptyCell(head), emptyCell(head));
      body.appendChild(row);
    }
    host.appendChild(body);
    insertNodeAtCaret(host, htmlToNode("<p><br></p>"));
    // `insertNodeAtCaret` leaves the caret in the trailing paragraph, which is right for a zone
    // and wrong here: a new table is something you type into straight away.
    const first = host.rows[0]?.cells[0];
    if (first) caretInto(first);
  };

  const addRow = () =>
    tableOp((cell, host) => {
      if (host.rows.length >= MAX_TABLE_ROWS) return;
      const from = cell.parentElement as HTMLTableRowElement;
      const row = document.createElement("tr");
      // Always body cells: a second header row halfway down a table is never what was meant.
      for (let i = 0; i < from.cells.length; i++) row.appendChild(emptyCell(false));
      from.after(row);
      caretInto(row.cells[0]!);
    });

  const addColumn = () =>
    tableOp((cell, host) => {
      if (columnsOf(host) >= MAX_TABLE_COLUMNS) return;
      const at = cell.cellIndex;
      const owner = cell.parentElement;
      let landing: HTMLTableCellElement | null = null;
      for (const row of host.rows) {
        const neighbour = row.cells[at];
        const fresh = emptyCell(neighbour ? neighbour.tagName === "TH" : false);
        // A ragged row - fewer cells than the one the caret is in - gets the column appended
        // rather than skipped, so every row comes out the same width.
        if (neighbour) neighbour.after(fresh);
        else row.appendChild(fresh);
        if (row === owner) landing = fresh;
      }
      if (landing) caretInto(landing);
    });

  /**
   * Deleting the last row or column deletes the TABLE.
   *
   * An empty `<table>` is not a shape the block model has: the parser would produce a table with
   * no rows and the PDF renderer would draw an empty frame. The degenerate case is resolved here,
   * where the founder watches it happen, rather than silently at the next save.
   */
  const removeTable = (host: HTMLTableElement) => {
    const landing = htmlToNode("<p><br></p>") as HTMLElement;
    host.replaceWith(landing);
    caretInto(landing);
  };

  const deleteRow = () =>
    tableOp((cell, host) => {
      if (host.rows.length <= 1) return removeTable(host);
      const row = cell.parentElement as HTMLTableRowElement;
      const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLTableRowElement | null;
      row.remove();
      if (next?.cells[0]) caretInto(next.cells[0]);
    });

  const deleteColumn = () =>
    tableOp((cell, host) => {
      if (columnsOf(host) <= 1) return removeTable(host);
      const at = cell.cellIndex;
      for (const row of host.rows) row.cells[at]?.remove();
      const landing = host.rows[0]?.cells[Math.max(0, at - 1)];
      if (landing) caretInto(landing);
    });

  /**
   * Paste is sanitised through the round trip.
   *
   * Pasting from Word brings megabytes of `mso-` styles, nested tables and font tags. Rather than
   * filter them by hand, the pasted HTML is parsed to blocks and rendered back - so whatever
   * arrives is reduced to the same shapes the renderer draws, before it ever reaches the page.
   */
  const onPaste = (e: React.ClipboardEvent) => {
    if (disabled) return;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (html) {
      const { blocks: pasted, fields: pastedFields } = htmlToBlocks(html);
      const wrap = document.createElement("div");
      wrap.innerHTML = blocksToHtml(pasted, pastedFields);
      // Inserted newest-last: each node goes directly after the block the caret is in, so they
      // have to be placed in reverse to come out in reading order.
      const nodes = [...wrap.childNodes].reverse();
      for (const node of nodes) insertNodeAtCaret(node);
      return;
    }
    // Plain text goes in as text, through the command that keeps the native undo stack intact.
    insertText(text);
  };

  /** Clicking a zone selects it, so the inspector beside the page follows the page. */
  const onClick = (e: React.MouseEvent) => {
    const zone = (e.target as HTMLElement).closest<HTMLElement>("[data-field-id]");
    if (zone?.dataset.fieldId) onFocusField(zone.dataset.fieldId);
  };

  /** Highlight the selected zone without re-rendering the page out from under the caret. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const zone of el.querySelectorAll<HTMLElement>("[data-field-id]")) {
      zone.classList.toggle("is-selected", zone.dataset.fieldId === selectedId);
    }
  });

  handlers.current = { sync, syncNow, onPaste, onClick };

  /**
   * THE PAGE ELEMENT, BUILT ONCE.
   *
   * This is the fix for the bug that cost the most time here: with the element re-created on
   * every render, React reconciled it and reset its contents to `dangerouslySetInnerHTML` - so a
   * signature zone inserted through the DOM appeared, and was silently wiped a moment later when
   * the parent re-rendered. The DOM inside a contenteditable belongs to the browser, and React
   * has to be kept out of it.
   *
   * A `useMemo` with no dependencies returns the SAME element object on every render, which makes
   * React bail out of reconciling this subtree entirely. Everything that would otherwise be a
   * changing prop - the handlers, the editable flag - is reached through a ref or set on the DOM.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const page = useMemo(
    () => (
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Agreement document"
        spellCheck
        onInput={() => handlers.current.sync()}
        onBlur={() => handlers.current.syncNow()}
        onPaste={(e) => handlers.current.onPaste(e)}
        onClick={(e) => handlers.current.onClick(e)}
        className="agreement-doc mx-auto min-h-[60vh] max-w-[820px] rounded-card bg-surface px-6 py-10 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-primary-soft sm:px-14"
        dangerouslySetInnerHTML={{ __html: initialHtml.current! }}
      />
    ),
    [],
  );

  return (
    <div className="space-y-2">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-field border border-line bg-surface/95 p-1.5 backdrop-blur"
      >
        <Group>
          <Tool label="Undo" onClick={() => run("undo")} disabled={disabled}>
            <Undo2 size={15} />
          </Tool>
          <Tool label="Redo" onClick={() => run("redo")} disabled={disabled}>
            <Redo2 size={15} />
          </Tool>
        </Group>

        <Divider />

        <StyleMenu disabled={disabled} onPick={setBlockTag} />

        <Divider />

        <Group>
          <Tool label="Bold" active={marks.bold} onClick={() => run("bold")} disabled={disabled}>
            <Bold size={15} />
          </Tool>
          <Tool label="Italic" active={marks.italic} onClick={() => run("italic")} disabled={disabled}>
            <Italic size={15} />
          </Tool>
          <Tool
            label="Underline"
            active={marks.underline}
            onClick={() => run("underline")}
            disabled={disabled}
          >
            <Underline size={15} />
          </Tool>
        </Group>

        <Divider />

        <Group>
          <Tool
            label="Bulleted list"
            active={marks.insertUnorderedList}
            onClick={() => run("insertUnorderedList")}
            disabled={disabled}
          >
            <List size={15} />
          </Tool>
          <Tool
            label="Numbered list"
            active={marks.insertOrderedList}
            onClick={() => run("insertOrderedList")}
            disabled={disabled}
          >
            <ListOrdered size={15} />
          </Tool>
        </Group>

        <Divider />

        <Group>
          <Tool
            label="Align left"
            active={!marks.justifyCenter && !marks.justifyRight && !marks.justifyFull}
            onClick={() => run("justifyLeft")}
            disabled={disabled}
          >
            <AlignLeft size={15} />
          </Tool>
          <Tool label="Centre" active={marks.justifyCenter} onClick={() => run("justifyCenter")} disabled={disabled}>
            <AlignCenter size={15} />
          </Tool>
          <Tool label="Align right" active={marks.justifyRight} onClick={() => run("justifyRight")} disabled={disabled}>
            <AlignRight size={15} />
          </Tool>
          <Tool label="Justify" active={marks.justifyFull} onClick={() => run("justifyFull")} disabled={disabled}>
            <AlignJustify size={15} />
          </Tool>
        </Group>

        <Divider />

        <Group>
          <FieldMenu disabled={disabled} onPick={addZone} />
          <Tool
            label="Insert a divider"
            onClick={() => insertNodeAtCaret(htmlToNode("<hr>"), htmlToNode("<p><br></p>"))}
            disabled={disabled}
          >
            <Minus size={15} />
          </Tool>
          <Tool
            label="Insert a page break"
            onClick={() =>
              insertNodeAtCaret(
                htmlToNode(
                  '<div class="agreement-break" contenteditable="false" data-page-break="1"><span>Page break</span></div>',
                ),
                htmlToNode("<p><br></p>"),
              )
            }
            disabled={disabled}
          >
            <Scissors size={15} />
          </Tool>
        </Group>

        <Divider />

        {/*
          TABLES. "Insert" is always available; the other four act on the table the caret is in
          and say so by being disabled everywhere else. Row and column are separate buttons
          rather than one "table" menu because they are the two things done most often - the
          founder adding a line to a fee schedule should not have to open anything.
        */}
        <Group>
          <Tool label="Insert a table" onClick={insertTable} disabled={disabled}>
            <Table size={15} />
          </Tool>
          <Tool
            label={
              table
                ? table.rows >= MAX_TABLE_ROWS
                  ? `A table can have at most ${MAX_TABLE_ROWS} rows`
                  : "Add a row below"
                : "Add a row below (put the cursor in a table first)"
            }
            onClick={addRow}
            disabled={disabled || !table || table.rows >= MAX_TABLE_ROWS}
          >
            <Rows3 size={15} />
          </Tool>
          <Tool
            label={
              table
                ? table.cols >= MAX_TABLE_COLUMNS
                  ? `A table can have at most ${MAX_TABLE_COLUMNS} columns`
                  : "Add a column to the right"
                : "Add a column to the right (put the cursor in a table first)"
            }
            onClick={addColumn}
            disabled={disabled || !table || table.cols >= MAX_TABLE_COLUMNS}
          >
            <Columns3 size={15} />
          </Tool>
          <Tool
            label={table ? "Delete this row" : "Delete a row (put the cursor in a table first)"}
            onClick={deleteRow}
            disabled={disabled || !table}
            wide
          >
            <Rows3 size={15} />
            <Trash2 size={11} className="-ml-0.5 self-end" />
          </Tool>
          <Tool
            label={table ? "Delete this column" : "Delete a column (put the cursor in a table first)"}
            onClick={deleteColumn}
            disabled={disabled || !table}
            wide
          >
            <Columns3 size={15} />
            <Trash2 size={11} className="-ml-0.5 self-end" />
          </Tool>
        </Group>
      </div>

      {/*
        The page. Sized and typeset to echo what the PDF renderer produces - an A4-ish measure,
        the same heading colour, justified body - so the editor reads as the document rather than
        as a form that happens to contain it.
      */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface-2 p-3 sm:p-6">
        {page}
      </div>

      <p className="text-xs text-muted">
        Type as you would in Word. Pasted formatting is cleaned up to what the PDF can print.
        Fields are fixed blocks - click one to set who signs it, or select and delete it. New
        fields are the student&apos;s until you say otherwise. Put the cursor in a table to add or
        remove its rows and columns.
      </p>
    </div>
  );
}

/**
 * The paragraph-style menu.
 *
 * Buttons, not a `<select>`. Every control in this toolbar has to leave the caret alone, and the
 * only way to do that is `preventDefault` on mousedown - which a native select cannot do, because
 * opening it IS the focus change. With a select here, choosing "Section heading" applied the
 * command to nothing.
 */
function StyleMenu({ disabled, onPick }: { disabled?: boolean; onPick: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const items: [string, string][] = [
    ["h1", "Title"],
    ["h2", "Section heading"],
    ["h3", "Sub-heading"],
    ["p", "Body text"],
  ];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Paragraph style"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-btn border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40"
      >
        Style
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-9 z-20 w-44 overflow-hidden rounded-field border border-line bg-surface py-1 shadow-card"
        >
          {items.map(([tag, label]) => (
            <button
              key={tag}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(tag);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * WHICH KIND OF FIELD TO ADD.
 *
 * This replaced a single button labelled "Signature zone", which was the only way to get a field
 * of ANY kind into a Word document: you inserted a signature and then changed its type in the
 * inspector. Six of the seven kinds were therefore reachable only by somebody who already knew
 * that, and a founder looking for "add a date box" correctly concluded there wasn't one. The PDF
 * designer next door has always had a type picker - this is the same choice, in the one shape
 * this toolbar allows (see `StyleMenu` on why a native select cannot be used here).
 *
 * Signature is first because it is the common case, and every kind lands on the STUDENT, who is
 * the party a document is usually missing a box for. The inspector opens on the new field, so
 * reassigning it to B2 or a guardian is the next click.
 */
function FieldMenu({ disabled, onPick }: { disabled?: boolean; onPick: (kind: FieldKind) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Insert a field"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-btn px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
      >
        <PenLine size={15} />
        Field
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-9 z-20 w-48 overflow-hidden rounded-field border border-line bg-surface py-1 shadow-card"
        >
          {FIELD_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(kind);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-primary"
            >
              {FIELD_KIND_LABELS[kind]}
            </button>
          ))}
          <p className="mt-1 border-t border-line px-3 pt-1.5 text-[11px] text-muted">
            Added for the student. Change who signs it beside the page.
          </p>
        </div>
      )}
    </div>
  );
}

/** The widest row's cell count - what the PDF renderer uses as the column count. */
function columnsOf(host: HTMLTableElement): number {
  return Math.max(0, ...[...host.rows].map((r) => r.cells.length));
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />;
}

function Tool({
  label,
  children,
  onClick,
  active,
  disabled,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // The toolbar must not steal the selection: without this the caret is lost the moment a
      // button is pressed, and the command then applies to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center rounded-btn px-2 transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        wide ? "" : "w-8"
      } ${active ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-surface-2 hover:text-primary"}`}
    >
      {children}
    </button>
  );
}
