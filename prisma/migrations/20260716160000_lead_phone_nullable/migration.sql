--- Lead.phone becomes nullable — required by the Synamate import (16 Jul 2026).
---
--- The Synamate/GoHighLevel export carries 23,432 contacts, of which 5,886 have NO phone
--- number (5,086 of those have no email either). `phone` was NOT NULL, which would have
--- rejected a quarter of the real CRM.
---
--- This widens the column: it cannot fail and destroys nothing. Existing rows keep their
--- phone; only the constraint is dropped.
---
--- CONSEQUENCE FOR CALLERS — the type system now forces this, but stating it plainly:
--- a lead may have no phone. Every send path (WATI/WhatsApp, the Outreach SOP ladder,
--- the telecaller dialer) must skip such a lead rather than dial an empty string. The
--- app-side guards landed with this migration.
---
--- NOTE: this is a one-way door in practice. Re-adding NOT NULL later requires deleting
--- or backfilling the ~5.9k phoneless rows first.

ALTER TABLE "lead" ALTER COLUMN "phone" DROP NOT NULL;
