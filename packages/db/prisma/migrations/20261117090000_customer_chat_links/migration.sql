-- CreateTable
CREATE TABLE "customer_chat_links" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "token" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_chat_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_chats" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_chats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_chat_links_botId_key" ON "customer_chat_links"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_chat_links_token_key" ON "customer_chat_links"("token");

-- CreateIndex
CREATE INDEX "customer_chat_links_spaceId_idx" ON "customer_chat_links"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_chats_linkId_visitorId_key" ON "customer_chats"("linkId", "visitorId");

-- AddForeignKey
ALTER TABLE "customer_chat_links" ADD CONSTRAINT "customer_chat_links_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_chat_links" ADD CONSTRAINT "customer_chat_links_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_chats" ADD CONSTRAINT "customer_chats_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "customer_chat_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
