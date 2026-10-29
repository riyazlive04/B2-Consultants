-- IMPROVEMENT RECORDINGS  (src/lib/recording.ts)
--
-- One enum and one table. PURELY ADDITIVE: no existing table is altered, no column is dropped,
-- no data is rewritten. `improvement` and `user` each gain a back-relation, which is a
-- Prisma-side change only and emits no SQL.
--
-- A reporter can attach ONE recording: their voice (AUDIO), or their screen with their voice
-- over it (SCREEN). SCREEN does not replace AUDIO - `getDisplayMedia` does not exist on iOS.
--
-- WRITTEN BY HAND, like every other migration on this schema. `prisma migrate dev` must not be
-- pointed at this repo while `.env` is present at all: `.env` carries the LIVE Supabase URL and
-- the Prisma CLI prefers it over a shell-set DATABASE_URL, so the "local" migration lands on
-- production. CREATE TYPE and CREATE TABLE are instant and lock nothing existing.
--
-- Safe to apply AHEAD of the image: nothing reads this table until the new code ships, so
-- `npm run db:deploy` first and the container afterwards - the order this VPS needs anyway,
-- having no migrate gate of its own.
--
-- ON THE `bytea` COLUMN: a recording is capped at 25 MB in src/lib/recording.ts and Postgres
-- TOASTs it out of the main heap, so the row itself stays narrow. It is a separate table
-- precisely so that no query can load the media without asking for it by name.

-- CreateEnum
CREATE TYPE "ImprovementRecordingKind" AS ENUM ('AUDIO', 'SCREEN');

-- CreateTable
CREATE TABLE "improvement_recording" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "kind" "ImprovementRecordingKind" NOT NULL,
    "bytes" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_recording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Unique, not merely indexed: one recording per report, so re-recording REPLACES rather than
-- leaving a reader to choose between two versions of the same explanation.
CREATE UNIQUE INDEX "improvement_recording_reportId_key" ON "improvement_recording"("reportId");

-- AddForeignKey
-- CASCADE is the only deletion path. `improvement` is soft-deleted (deletedAt), so archiving a
-- report deliberately KEEPS its recording; this fires only on a genuine hard delete.
ALTER TABLE "improvement_recording" ADD CONSTRAINT "improvement_recording_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "improvement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT on the recorder, matching `improvement.reporterId`: "whose voice is this?" must stay
-- answerable, so a user row carrying a recording cannot be deleted out from under it.
ALTER TABLE "improvement_recording" ADD CONSTRAINT "improvement_recording_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
