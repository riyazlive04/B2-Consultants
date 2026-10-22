-- Course material, attached to a curriculum row, a batch, or a single class.
--
-- Additive only: one new enum, one new table. Nothing existing is touched.

DO $$ BEGIN
    CREATE TYPE "ResourceKind" AS ENUM ('DOCUMENT', 'VIDEO', 'TEMPLATE', 'TOOL', 'LINK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "resource" (
    "id"                TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "description"       TEXT,
    "kind"              "ResourceKind" NOT NULL DEFAULT 'LINK',
    "url"               TEXT NOT NULL,
    "curriculumItemId"  TEXT,
    "batchId"           TEXT,
    "sessionId"         TEXT,
    "orderIndex"        INTEGER NOT NULL DEFAULT 0,
    "visibleToStudents" BOOLEAN NOT NULL DEFAULT true,
    "createdById"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- EXACTLY ONE SCOPE. The service layer checks this too, but the constraint is what makes it
-- true: a row scoped to both a batch and a session would appear twice in the student's list and
-- there would be no non-arbitrary way to decide which one to drop at read time.
DO $$ BEGIN
    ALTER TABLE "resource" ADD CONSTRAINT "resource_one_scope" CHECK (
        (("curriculumItemId" IS NOT NULL)::int
       + ("batchId" IS NOT NULL)::int
       + ("sessionId" IS NOT NULL)::int) = 1
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "resource_curriculumItemId_orderIndex_idx" ON "resource"("curriculumItemId", "orderIndex");
CREATE INDEX IF NOT EXISTS "resource_batchId_orderIndex_idx"          ON "resource"("batchId", "orderIndex");
CREATE INDEX IF NOT EXISTS "resource_sessionId_orderIndex_idx"        ON "resource"("sessionId", "orderIndex");

-- CASCADE on the three scopes: a resource has no meaning once the thing it describes is gone,
-- unlike a message or a register, which are evidence. SetNull on the author, like every other
-- actor link - removing a coach's login must not delete the material they posted.
DO $$ BEGIN
    ALTER TABLE "resource" ADD CONSTRAINT "resource_curriculumItemId_fkey"
        FOREIGN KEY ("curriculumItemId") REFERENCES "curriculum_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "resource" ADD CONSTRAINT "resource_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "resource" ADD CONSTRAINT "resource_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER TABLE "resource" ADD CONSTRAINT "resource_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
