-- FILES ATTACHED TO AN IMPROVEMENT REPORT  (src/lib/attachment.ts)
--
-- One table. PURELY ADDITIVE: no existing table is altered, no column is dropped, no data is
-- rewritten. `improvement` and `user` each gain a back-relation, which is a Prisma-side change
-- only and emits no SQL.
--
-- The evidence from OUTSIDE the app: the statement the figure should have matched, the invoice
-- the student was sent, the spreadsheet the real numbers live in, the photo of a screen taken
-- on a phone where screen capture does not exist. None of that can be recorded from a browser
-- tab and none of it fits in a text box.
--
-- MANY rows per report, which is the one structural difference from `improvement_recording`:
-- that table is UNIQUE on reportId because a second recording of the same explanation only
-- gives a reader a choice to make, whereas a figure that disagrees with a statement genuinely
-- needs the screenshot AND the statement. Capped instead: 5 files, 10 MB each, 20 MB in total,
-- all enforced in src/lib/attachment.ts rather than in SQL, because a cap a person runs into
-- has to come back as a sentence they can act on and not as a constraint violation.
--
-- WRITTEN BY HAND, like every other migration on this schema. `prisma migrate dev` must not be
-- pointed at this repo while `.env` is present at all: `.env` carries a LIVE database URL and
-- the Prisma CLI prefers it over a shell-set DATABASE_URL, so the "local" migration lands on
-- production. CREATE TABLE and CREATE INDEX on a new table are instant and lock nothing existing.
--
-- Safe to apply AHEAD of the image: nothing reads this table until the new code ships, so
-- `npm run db:deploy` first and the container afterwards - the order this VPS needs anyway,
-- having no migrate gate of its own.
--
-- ON THE `bytea` COLUMN: each file is capped at 10 MB and Postgres TOASTs it out of the main
-- heap, so the row itself stays narrow. It is a separate table precisely so that no query can
-- load the bytes without asking for them by name - `bytes` is a scalar, and Prisma selects every
-- scalar on any findMany that names no `select`.

-- CreateTable
CREATE TABLE "improvement_attachment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    -- Rebuilt from the uploader's filename, never stored as given: safe characters only, and the
    -- extension comes from the magic-byte sniff. See `safeAttachmentName`.
    "filename" TEXT NOT NULL,
    -- Sniffed from the bytes, never from the request. Becomes the Content-Type of a download.
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The only access pattern there is: one report's files, in the order they were attached. Nothing
-- queries this table globally, and nothing should - it holds bytes.
CREATE INDEX "improvement_attachment_reportId_createdAt_idx" ON "improvement_attachment"("reportId", "createdAt");

-- AddForeignKey
-- CASCADE is the only deletion path. `improvement` is soft-deleted (deletedAt), so archiving a
-- report deliberately KEEPS its files; this fires only on a genuine hard delete.
ALTER TABLE "improvement_attachment" ADD CONSTRAINT "improvement_attachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "improvement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT on the uploader, matching `improvement_recording_recordedById_fkey`: "where did this
-- document come from?" must stay answerable, so a user row carrying an attachment cannot be
-- deleted out from under it.
ALTER TABLE "improvement_attachment" ADD CONSTRAINT "improvement_attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
