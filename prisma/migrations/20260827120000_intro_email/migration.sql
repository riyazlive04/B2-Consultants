-- Step 3b: the opt-in welcome also goes by email, so the SOP ladder owns all of the
-- founder's Step 1 rather than sharing it with an automation workflow.
ALTER TYPE "OutreachStep" ADD VALUE IF NOT EXISTS 'INTRO_EMAIL';
