-- A workspace now holds several boards: its first board is the default, the rest are named.
-- The one-board-per-space constraint goes; a ticket prefix becomes unique inside a workspace
-- instead, so a reference like MKT-4 still names exactly one board.
--
-- Relaxing a constraint is safe while the previous release runs: its single-board reads keep
-- returning one row, and the new unique index cannot already be violated because each space
-- had at most one board.

DROP INDEX "boards_spaceId_key";

CREATE INDEX "boards_spaceId_idx" ON "boards"("spaceId");

CREATE UNIQUE INDEX "boards_spaceId_ticketPrefix_key" ON "boards"("spaceId", "ticketPrefix");