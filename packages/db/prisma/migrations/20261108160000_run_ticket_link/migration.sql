-- A run can be linked to the board ticket it is working. Nullable, so runs from every other
-- trigger are unaffected, and the link is what stops one ticket being worked twice at once.
--
-- Adding a nullable column and an index is safe while the previous release runs: it never
-- writes the column and does not read it.

ALTER TABLE "runs" ADD COLUMN "ticketId" TEXT;

CREATE INDEX "runs_ticketId_status_idx" ON "runs"("ticketId", "status");

ALTER TABLE "runs" ADD CONSTRAINT "runs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;