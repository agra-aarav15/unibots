-- Additive: the previous release never reads or writes this table.
CREATE TABLE "bot_memory_states" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "lastCuratedSeq" INTEGER NOT NULL DEFAULT -1,
    "lastCuratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_memory_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_memory_states_botId_key" ON "bot_memory_states"("botId");

ALTER TABLE "bot_memory_states" ADD CONSTRAINT "bot_memory_states_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same tenant policy as steering_messages (20261022120000_row_level_security_tenant_tables).
ALTER TABLE "bot_memory_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_memory_states_tenant ON "bot_memory_states"
  USING (EXISTS (
    SELECT 1 FROM "bots" b
    WHERE b."id" = "bot_memory_states"."botId"
      AND b."spaceId" = NULLIF(current_setting('app.space_id', true), '')
  ));
CREATE POLICY bot_memory_states_system ON "bot_memory_states"
  USING (current_setting('app.rls_bypass', true) = 'on');