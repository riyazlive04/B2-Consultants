-- Pabbly Connect relay as a lead ingest source.
-- Pabbly fans each inbound opt-in out to BOTH Synamate and this app; PABBLY marks the pipe the
-- row arrived through. The lead's real origin (Meta ad, IG, landing page) is carried separately
-- on Lead.leadSource, mapped from the payload by /api/leads/pabbly.
ALTER TYPE "Source" ADD VALUE 'PABBLY';
