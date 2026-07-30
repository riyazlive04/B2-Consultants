-- ER v2 Track H — job descriptions, and CVs that belong to students.
--
-- ResumeReview already IS the diagram's CV_JD_MATCH (scoreOverall 0–100 + suggestions JSON).
-- It gains an optional link to a reusable JobDescription; `jdText` STAYS as the frozen
-- snapshot, because a JD can be edited afterwards and the review must show what was actually
-- matched against.

CREATE TABLE "job_description" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "url" TEXT,
    "language" TEXT NOT NULL DEFAULT 'EN',
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_description_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_description_active_createdAt_idx" ON "job_description"("active", "createdAt");

-- A real FK, unlike ownerUserId/leadId which stay soft references: "how many of our students
-- have a CV" was previously unanswerable.
ALTER TABLE "resume" ADD COLUMN "studentId" TEXT;
ALTER TABLE "resume" ADD CONSTRAINT "resume_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "resume_studentId_idx" ON "resume"("studentId");

ALTER TABLE "resume_review" ADD COLUMN "jobDescriptionId" TEXT;
ALTER TABLE "resume_review" ADD CONSTRAINT "resume_review_jobDescriptionId_fkey"
  FOREIGN KEY ("jobDescriptionId") REFERENCES "job_description"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "resume_review_jobDescriptionId_idx" ON "resume_review"("jobDescriptionId");

-- company / role / jobUrl on job_application stay as the record of what was applied to, so an
-- application whose JD was later retired still reads correctly.
ALTER TABLE "job_application" ADD COLUMN "resumeId" TEXT;
ALTER TABLE "job_application" ADD COLUMN "jobDescriptionId" TEXT;
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_jobDescriptionId_fkey"
  FOREIGN KEY ("jobDescriptionId") REFERENCES "job_description"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "job_application_jobDescriptionId_idx" ON "job_application"("jobDescriptionId");
