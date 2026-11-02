-- Additive: the previous release never reads or writes this table.
CREATE TABLE "device_pairings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pairings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_pairings_codeHash_key" ON "device_pairings"("codeHash");
CREATE INDEX "device_pairings_expiresAt_idx" ON "device_pairings"("expiresAt");

-- Same tenant policy as steering_messages: the row belongs to the Space that made it.
ALTER TABLE "device_pairings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_pairings_tenant ON "device_pairings"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY device_pairings_system ON "device_pairings"
  USING (current_setting('app.rls_bypass', true) = 'on');