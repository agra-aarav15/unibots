-- Ticket references are read by people and quoted by the bots, so a new board takes the product's
-- own prefix. Existing boards keep theirs: their tickets already carry it, and renaming the prefix
-- of a board that has tickets is refused anyway.
ALTER TABLE "boards" ALTER COLUMN "ticketPrefix" SET DEFAULT 'UNI';
