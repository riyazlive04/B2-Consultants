/**
 * `DocBlock[]` → HTML, for the document editor. The exact inverse of `lib/docx-blocks`.
 *
 * ── WHY A ROUND TRIP RATHER THAN AN EDITOR STATE ────────────────────────────────────────────
 * The editor is a `contenteditable` page: the browser owns the DOM while somebody is typing, and
 * what comes back out is whatever HTML the browser felt like producing - `<div>`s for paragraphs,
 * `<font>` tags, inline styles, nested spans. Rather than fight that, the block model is the only
 * state that is ever SAVED, and `htmlToBlocks` is the gate every keystroke eventually passes
 * through. Anything the parser does not recognise is dropped, so the document can never contain a
 * shape the PDF renderer has not been taught to draw.
 *
 * That makes this file the other half of a contract:
 *
 *     blocks → blocksToHtml → contenteditable → htmlToBlocks → blocks
 *
 * must be the identity. `__tests__/blocks-html.test.ts` pins exactly that, because a round trip
 * that quietly loses a heading level or a bold run would corrupt a contract one edit at a time.
 *
 * It is also the paste sanitiser: HTML pasted from Word goes through `htmlToBlocks` and back
 * through here, so what lands in the page is already reduced to shapes we render.
 */

import {
  defaultFieldLabel,
  FIELD_KIND_LABELS,
  SIGNER_LABELS,
  type DocBlock,
  type DocField,
  type DocInline,
} from "./agreement-doc";

/** HTML-escape. Text in a contract can legitimately contain `<`, `&` and quotes. */
export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One run, with its marks nested in a fixed order so the output is stable. */
function runHtml(run: DocInline): string {
  // Newlines inside a run come from `<br>` in the source and have to go back as `<br>`.
  let html = esc(run.text).replace(/\n/g, "<br>");
  if (run.u) html = `<u>${html}</u>`;
  if (run.i) html = `<em>${html}</em>`;
  if (run.b) html = `<strong>${html}</strong>`;
  if (run.href) html = `<a href="${esc(run.href)}">${html}</a>`;
  return html;
}

function runsHtml(runs: readonly DocInline[]): string {
  // A genuinely empty paragraph still needs a line box, or the cursor cannot be put in it.
  return runs.map(runHtml).join("") || "<br>";
}

/**
 * The signature-zone widget.
 *
 * `contenteditable="false"` makes it ATOMIC: the browser treats it as a single character, so it
 * cannot be typed into, half-deleted, or split by pressing Enter inside it. `data-field-id` is
 * what survives the round trip - `htmlToBlocks` turns any element carrying one back into a field
 * block, whatever the browser did to the rest of the markup.
 */
export function zoneHtml(field: DocField): string {
  const caption = field.label?.trim() || defaultFieldLabel(field.kind, field.signer);
  return (
    `<div class="agreement-zone" contenteditable="false" data-field-id="${esc(field.id)}" ` +
    `data-kind="${esc(field.kind)}" data-signer="${esc(field.signer)}">` +
    `<span class="agreement-zone__caption">${esc(caption)}</span>` +
    `<span class="agreement-zone__meta">${esc(FIELD_KIND_LABELS[field.kind])} · ${esc(SIGNER_LABELS[field.signer])}</span>` +
    `</div>`
  );
}

export function blocksToHtml(blocks: readonly DocBlock[], fields: readonly DocField[]): string {
  const byId = new Map(fields.map((f) => [f.id, f]));

  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level}>${runsHtml(block.runs)}</h${block.level}>`;

        case "p": {
          const style = block.align ? ` style="text-align:${block.align}"` : "";
          return `<p${style}>${runsHtml(block.runs)}</p>`;
        }

        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items.map((item) => `<li>${runsHtml(item)}</li>`).join("");
          return `<${tag}>${items}</${tag}>`;
        }

        case "table": {
          const rows = block.rows
            .map((row) => {
              const cell = row.head ? "th" : "td";
              const cells = row.cells.map((c) => `<${cell}>${runsHtml(c)}</${cell}>`).join("");
              return `<tr>${cells}</tr>`;
            })
            .join("");
          return `<table><tbody>${rows}</tbody></table>`;
        }

        case "field": {
          const field = byId.get(block.fieldId);
          // An anchor with no field behind it: keep the anchor so the round trip does not silently
          // delete it, and let `validateDocBody` be the thing that reports it.
          return field
            ? zoneHtml(field)
            : `<div class="agreement-zone agreement-zone--orphan" contenteditable="false" data-field-id="${esc(
                block.fieldId,
              )}"><span class="agreement-zone__caption">Signature zone with no field behind it</span></div>`;
        }

        case "rule":
          return "<hr>";

        case "pageBreak":
          /**
           * A page break has no HTML equivalent that survives `contenteditable`, so it is an
           * atomic widget like a signature zone, recognised on the way back by its class.
           */
          return `<div class="agreement-break" contenteditable="false" data-page-break="1"><span>Page break</span></div>`;
      }
    })
    .join("\n");
}
