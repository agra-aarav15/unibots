-- An invitation becomes a way into one workspace: the link's secret, the workspace it opens,
-- and the moment it was used. Additive, so the previous release — which never reads these
-- columns — keeps running beside this one.
--
-- `email` loses NOT NULL because a link-only invitation has no address to name. Relaxing a
-- constraint is safe for the running release, which still writes an address.

ALTER TABLE "invitation" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "invitation" ADD COLUMN "token" TEXT;
ALTER TABLE "invitation" ADD COLUMN "acceptedAt" TIMESTAMP(3);

ALTER TABLE "invitation" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "invitation_token_key" ON "invitation"("token");

CREATE INDEX "invitation_spaceId_idx" ON "invitation"("spaceId");

ALTER TABLE "invitation" ADD CONSTRAINT "invitation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
