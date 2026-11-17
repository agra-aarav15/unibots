import { randomBytes } from "node:crypto";
import type { MessageBlock } from "@unibot/contracts";
import type { PrismaClient, ThreadEvents } from "@unibot/db";

/** External conversations from a public chat link are labelled with this provider. */
export const CUSTOMER_CHAT_PROVIDER = "customer-page";
export const CUSTOMER_CHAT_MESSAGE_MAX_CHARS = 2_000;
/** One visitor's messages per window, so a link cannot be used to run a bot in a loop. */
export const CUSTOMER_CHAT_MESSAGES_PER_WINDOW = 30;
export const CUSTOMER_CHAT_WINDOW_MS = 60 * 60 * 1_000;
const CUSTOMER_CHAT_PAGE_MESSAGES = 100;

export const CUSTOMER_CHAT_LINK_UNKNOWN = "This chat link is not valid any more.";
export const CUSTOMER_CHAT_RATE_LIMITED = "That is a lot of messages. Try again a little later.";
export const CUSTOMER_CHAT_EMPTY_MESSAGE = "Write a message first.";
export const CUSTOMER_CHAT_TOO_LONG = `Keep it under ${CUSTOMER_CHAT_MESSAGE_MAX_CHARS} characters.`;

export interface CustomerChatDeps {
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "sendUserMessage">;
}

/** One message as the public page shows it: text only, and only this visitor's own thread. */
export interface CustomerChatMessage {
  seq: number;
  role: "customer" | "bot";
  text: string;
  at: string;
}

/** A fresh link token or visitor id. Unguessable, because the link is the only credential. */
export function newCustomerChatToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newVisitorId(): string {
  return randomBytes(18).toString("base64url");
}

export type CustomerChatError = { error: string };

/** The link row for a bot, or null. The token is what a shareable link carries. */
export async function getCustomerChatLink(
  deps: Pick<CustomerChatDeps, "prisma">,
  input: { spaceId: string; botId: string },
) {
  return deps.prisma.customerChatLink.findFirst({
    where: { spaceId: input.spaceId, botId: input.botId },
  });
}

/**
 * Mints the link for a bot, replacing any previous one, so the owner can always see and copy the
 * link that is live. Rotating is the recovery path for a link that leaked.
 */
export async function setCustomerChatLink(
  deps: Pick<CustomerChatDeps, "prisma">,
  input: { spaceId: string; botId: string; userId: string; name?: string | null },
) {
  const token = newCustomerChatToken();
  return deps.prisma.customerChatLink.upsert({
    where: { botId: input.botId },
    create: {
      spaceId: input.spaceId,
      botId: input.botId,
      userId: input.userId,
      token,
      ...(input.name ? { name: input.name } : {}),
    },
    update: { token, revokedAt: null, ...(input.name ? { name: input.name } : {}) },
  });
}

export async function revokeCustomerChatLink(
  deps: Pick<CustomerChatDeps, "prisma">,
  input: { spaceId: string; botId: string },
) {
  await deps.prisma.customerChatLink.updateMany({
    where: { spaceId: input.spaceId, botId: input.botId },
    data: { revokedAt: new Date() },
  });
}

/** The live link a token names. A revoked or unknown token is refused the same way. */
export async function linkForCustomerChatToken(
  deps: Pick<CustomerChatDeps, "prisma">,
  token: string,
) {
  const link = await deps.prisma.customerChatLink.findUnique({ where: { token } });
  return link && !link.revokedAt ? link : null;
}

/**
 * The visitor's conversation, created on first contact. It is an external conversation, so the
 * owner watches the sale in the same place as every other external chat, and the bot's replies,
 * tickets and payments all work in its ordinary thread.
 */
async function conversationFor(
  deps: CustomerChatDeps,
  link: { id: string; spaceId: string; botId: string; userId: string },
  visitorId: string,
) {
  return deps.prisma.externalConversation.upsert({
    where: {
      provider_workspaceId_externalKey: {
        provider: CUSTOMER_CHAT_PROVIDER,
        workspaceId: link.id,
        externalKey: visitorId,
      },
    },
    create: {
      provider: CUSTOMER_CHAT_PROVIDER,
      workspaceId: link.id,
      externalKey: visitorId,
      conversationId: visitorId,
      displayName: `Visitor ${visitorId.slice(0, 6)}`,
      spaceId: link.spaceId,
      botId: link.botId,
      userId: link.userId,
      thread: { create: { spaceId: link.spaceId, userId: link.userId } },
    },
    update: {},
    include: { thread: { select: { id: true } } },
  });
}

/**
 * Takes a message from a visitor and wakes the bot in their thread. The bot sees it as its owner's
 * words carrying a customer's text, which is how a linked chat already reaches it.
 */
export async function sendCustomerChatMessage(
  deps: CustomerChatDeps,
  input: { token: string; visitorId: string; text: string },
): Promise<{ visitorId: string; seq: number | null } | CustomerChatError> {
  const text = input.text.trim();
  if (!text) return { error: CUSTOMER_CHAT_EMPTY_MESSAGE };
  if (text.length > CUSTOMER_CHAT_MESSAGE_MAX_CHARS) return { error: CUSTOMER_CHAT_TOO_LONG };
  const link = await linkForCustomerChatToken(deps, input.token);
  if (!link) return { error: CUSTOMER_CHAT_LINK_UNKNOWN };

  const now = Date.now();
  const chat = await deps.prisma.customerChat.upsert({
    where: { linkId_visitorId: { linkId: link.id, visitorId: input.visitorId } },
    // The count is what has been sent before this message, so the update below is the message.
    create: { linkId: link.id, visitorId: input.visitorId },
    update: {},
  });
  // The window is a rough guard against a runaway link, not an exact quota: two messages racing
  // can each read the same count, which costs at most one extra run.
  const expired = now - chat.windowStartedAt.getTime() >= CUSTOMER_CHAT_WINDOW_MS;
  const used = expired ? 0 : chat.messageCount;
  if (used >= CUSTOMER_CHAT_MESSAGES_PER_WINDOW) return { error: CUSTOMER_CHAT_RATE_LIMITED };

  const conversation = await conversationFor(deps, link, input.visitorId);
  const threadId = conversation.thread?.id;
  if (!threadId) throw new Error("customer chat conversation has no thread");
  const sent = await deps.events.sendUserMessage({
    spaceId: link.spaceId,
    threadId,
    botId: link.botId,
    userId: link.userId,
    blocks: [{ kind: "text", text }],
    prompt: `A customer wrote through your public chat link:\n\n${text}`,
    trigger: "messaging",
    clientNonce: `customer-chat:${chat.id}:${used + 1}`,
  });
  await deps.prisma.customerChat.update({
    where: { id: chat.id },
    data: {
      messageCount: used + 1,
      lastMessageAt: new Date(now),
      ...(expired ? { windowStartedAt: new Date(now) } : {}),
    },
  });
  return { visitorId: input.visitorId, seq: sent.seq };
}

function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .flatMap((block) => {
      const entry = block as MessageBlock;
      return entry?.kind === "text" && typeof entry.text === "string" ? [entry.text] : [];
    })
    .join("\n")
    .trim();
}

/** What this visitor has said and what the bot answered, in order, from a sequence number on. */
export async function listCustomerChatMessages(
  deps: Pick<CustomerChatDeps, "prisma">,
  input: { token: string; visitorId: string; after?: number },
): Promise<{ messages: CustomerChatMessage[] } | CustomerChatError> {
  const link = await linkForCustomerChatToken(deps, input.token);
  if (!link) return { error: CUSTOMER_CHAT_LINK_UNKNOWN };
  const conversation = await deps.prisma.externalConversation.findUnique({
    where: {
      provider_workspaceId_externalKey: {
        provider: CUSTOMER_CHAT_PROVIDER,
        workspaceId: link.id,
        externalKey: input.visitorId,
      },
    },
    include: { thread: { select: { id: true } } },
  });
  const threadId = conversation?.thread?.id;
  if (!threadId) return { messages: [] };
  const rows = await deps.prisma.message.findMany({
    where: { threadId, seq: { gt: Math.max(Math.trunc(input.after ?? 0), 0) } },
    orderBy: { seq: "asc" },
    take: CUSTOMER_CHAT_PAGE_MESSAGES,
    select: { seq: true, role: true, blocks: true, createdAt: true },
  });
  // Reads through the client come back decrypted; a ciphertext blob could never reach the page.
  return {
    messages: rows.flatMap((row) => {
      const text = blocksText(row.blocks);
      if (!text) return [];
      return [
        {
          seq: row.seq,
          role: row.role === "user" ? ("customer" as const) : ("bot" as const),
          text,
          at: row.createdAt.toISOString(),
        },
      ];
    }),
  };
}
