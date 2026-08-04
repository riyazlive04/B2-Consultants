/**
 * CSV serialisation for server-side exports.
 *
 * Isomorphic and dependency-free. `papaparse` already handles the client-side `DataTable`
 * export, but that runs in a browser over an array that is already in memory; these exports
 * stream tens of thousands of rows out of Postgres and must not buffer the whole file.
 */

/**
 * Quote one cell.
 *
 * ── The formula-injection guard ─────────────────────────────────────────────────
 * A value starting `=`, `+`, `-`, `@`, tab or CR is interpreted by Excel and Google Sheets as a
 * FORMULA when the file is opened, not as text. Since these exports carry lead names and notes
 * typed by strangers on a public form, that is a live injection path into whoever opens the
 * spreadsheet (`=HYPERLINK(...)`, `=IMPORTXML(...)` exfiltrating the row to a remote host). The
 * cell is prefixed with a single quote, which every spreadsheet reads as "treat as text" and
 * which is the standard, non-lossy mitigation.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "bigint"
        ? value.toString()
        : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Double up embedded quotes, then wrap — the RFC 4180 rule.
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(cell).join(",") + "\r\n";
}

/**
 * A `Response` that streams CSV as it is produced.
 *
 * `pages` yields arrays of already-formatted values. Streaming rather than building one big
 * string matters at this scale: 23,545 leads is a ~4MB string held in the server's heap for the
 * duration of the request, on a 1 vCPU box with no swap.
 *
 * The BOM is deliberate. Without it Excel on Windows reads the file as the system codepage and
 * mangles every non-ASCII character — which here means every German name.
 */
export function csvStreamResponse(
  filename: string,
  header: string[],
  pages: AsyncIterable<unknown[][]>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("﻿" + csvRow(header)));
      try {
        for await (const page of pages) {
          let chunk = "";
          for (const row of page) chunk += csvRow(row);
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // The headers have already been sent, so this cannot become a 500 — the honest thing is
        // to put the failure IN the file, where whoever opens it will see it, rather than
        // truncating silently and leaving them with a plausible-looking partial export.
        controller.enqueue(
          encoder.encode(csvRow([`EXPORT FAILED — ${err instanceof Error ? err.message : "unknown error"}`])),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
