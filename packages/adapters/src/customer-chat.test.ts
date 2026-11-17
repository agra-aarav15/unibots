import { describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_CHAT_MESSAGES_PER_WINDOW,
  CUSTOMER_CHAT_RATE_LIMITED,
  CUSTOMER_CHAT_WINDOW_MS,
  linkForCustomerChatToken,
  listCustomerChatMessages,
  revokeCustomerChatLink,
  sendCustomerChatMessage,
  setCustomerChatLink,
} from "./customer-chat.js";

const link = {
  id: "link-1",
  spaceId: "space-1",
  botId: "bot-1",
  userId: "user-1",
  name: null,
  token: "token-1",
  revokedAt: null as Date | null,
  createdAt: new Date("2026-11-17T08:00:00.000Z"),
  updatedAt: new Date("2026-11-17T08:00:00.000Z"),
};

function harness(overrides: { chat?: Record<string, unknown> } = {}) {
  const links: Array<typeof link> = [link];
  const chats = new Map<
    string,
    { id: string; messageCount: number; windowStartedAt: Date; lastMessageAt: Date | null }
  >();
  const conversations = new Map<string, { id: string; thread: { id: string } }>();
  const sendUserMessage = vi.fn(async () => ({
    messageId: "message-1",
    seq: 7,
    taskId: null,
    runId: "run-1",
  }));
  const storedMessages: Array<{ seq: number; role: string; blocks: unknown; createdAt: Date }> = [];
  const prisma = {
    customerChatLink: {
      findFirst: async ({ where }: { where: { spaceId: string; botId: string } }) =>
        links.find((row) => row.spaceId === where.spaceId && row.botId === where.botId) ?? null,
      findUnique: async ({ where }: { where: { token: string } }) =>
        links.find((row) => row.token === where.token) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { botId: string };
        create: object;
        update: object;
      }) => {
        const existing = links.find((row) => row.botId === where.botId);
        if (!existing) {
          const created = { ...link, ...create } as typeof link;
          links.push(created);
          return { ...created };
        }
        Object.assign(existing, update);
        return { ...existing };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { botId: string };
        data: { revokedAt: Date };
      }) => {
        const existing = links.find((row) => row.botId === where.botId);
        if (existing) existing.revokedAt = data.revokedAt;
        return { count: existing ? 1 : 0 };
      },
    },
    customerChat: {
      upsert: async ({
        where,
        create,
      }: {
        where: { linkId_visitorId: { linkId: string; visitorId: string } };
        create: { linkId: string; visitorId: string; messageCount: number; lastMessageAt: Date };
      }) => {
        const key = `${where.linkId_visitorId.linkId}:${where.linkId_visitorId.visitorId}`;
        const existing = chats.get(key);
        if (existing) return existing;
        const created = {
          id: `chat-${chats.size + 1}`,
          // The column defaults to 0 when the create omits it, as the database does.
          messageCount: create.messageCount ?? 0,
          windowStartedAt: new Date(),
          lastMessageAt: create.lastMessageAt ?? null,
          ...overrides.chat,
        };
        chats.set(key, created);
        return created;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { messageCount: number; lastMessageAt: Date; windowStartedAt?: Date };
      }) => {
        const existing = [...chats.values()].find((row) => row.id === where.id)!;
        existing.messageCount = data.messageCount;
        if (data.windowStartedAt) existing.windowStartedAt = data.windowStartedAt;
        return existing;
      },
      count: async () => chats.size,
    },
    externalConversation: {
      upsert: async ({
        where,
      }: {
        where: { provider_workspaceId_externalKey: { externalKey: string } };
      }) => {
        const key = where.provider_workspaceId_externalKey.externalKey;
        const existing = conversations.get(key);
        if (existing) return existing;
        const created = {
          id: `conversation-${conversations.size + 1}`,
          thread: { id: `thread-${conversations.size + 1}` },
        };
        conversations.set(key, created);
        return created;
      },
      findUnique: async ({
        where,
      }: {
        where: { provider_workspaceId_externalKey: { externalKey: string } };
      }) => conversations.get(where.provider_workspaceId_externalKey.externalKey) ?? null,
    },
    message: {
      findMany: async ({ where }: { where: { seq: { gt: number } } }) =>
        storedMessages
          .filter((message) => message.seq > where.seq.gt)
          .sort((a, b) => a.seq - b.seq),
    },
  };
  return {
    deps: { prisma: prisma as never, events: { sendUserMessage } },
    links,
    chats,
    sendUserMessage,
    storedMessages,
    prisma,
  };
}

describe("a public chat link", () => {
  it("mints a link the owner can read again, and rotating replaces it", async () => {
    const { deps, links } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    expect(minted.token).toBeTruthy();
    expect(await linkForCustomerChatToken(deps, minted.token)).toMatchObject({ botId: "bot-1" });
    const rotated = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    expect(rotated.token).not.toBe(minted.token);
    expect(links).toHaveLength(1);
    expect(await linkForCustomerChatToken(deps, minted.token)).toBeNull();
  });

  it("stops answering once the owner revokes it", async () => {
    const { deps, sendUserMessage } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    await revokeCustomerChatLink(deps, { spaceId: "space-1", botId: "bot-1" });
    expect(await linkForCustomerChatToken(deps, minted.token)).toBeNull();
    await expect(
      sendCustomerChatMessage(deps, { token: minted.token, visitorId: "visitor-1", text: "hello" }),
    ).resolves.toMatchObject({ error: expect.stringContaining("not valid") });
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("gives a visitor a thread of their own and wakes the bot with what they wrote", async () => {
    const { deps, sendUserMessage, prisma } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    const sent = await sendCustomerChatMessage(deps, {
      token: minted.token,
      visitorId: "visitor-1",
      text: "  Do you sell the 499 plan?  ",
    });
    expect(sent).toEqual({ visitorId: "visitor-1", seq: 7 });
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
        botId: "bot-1",
        userId: "user-1",
        trigger: "messaging",
        blocks: [{ kind: "text", text: "Do you sell the 499 plan?" }],
        prompt: expect.stringContaining("Do you sell the 499 plan?"),
      }),
    );
    // The first message is what created the conversation, and it is an external one.
    const conversation = await prisma.externalConversation.findUnique({
      where: {
        provider_workspaceId_externalKey: {
          provider: "customer-page",
          workspaceId: "link-1",
          externalKey: "visitor-1",
        },
      },
    } as never);
    expect(conversation).toMatchObject({ thread: { id: expect.any(String) } });
  });

  it("refuses an empty message or one that is too long, without running anything", async () => {
    const { deps, sendUserMessage } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    await expect(
      sendCustomerChatMessage(deps, { token: minted.token, visitorId: "v", text: "   " }),
    ).resolves.toMatchObject({ error: "Write a message first." });
    await expect(
      sendCustomerChatMessage(deps, {
        token: minted.token,
        visitorId: "v",
        text: "x".repeat(2_001),
      }),
    ).resolves.toMatchObject({ error: expect.stringContaining("under 2000") });
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("stops one visitor from running the bot in a loop, and lets them back in later", async () => {
    const { deps, sendUserMessage } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    const chat = { token: minted.token, visitorId: "visitor-1" };
    for (let index = 0; index < CUSTOMER_CHAT_MESSAGES_PER_WINDOW; index += 1)
      await sendCustomerChatMessage(deps, { ...chat, text: `message ${index}` });
    expect(sendUserMessage).toHaveBeenCalledTimes(CUSTOMER_CHAT_MESSAGES_PER_WINDOW);
    await expect(sendCustomerChatMessage(deps, { ...chat, text: "one more" })).resolves.toEqual({
      error: CUSTOMER_CHAT_RATE_LIMITED,
    });
    expect(sendUserMessage).toHaveBeenCalledTimes(CUSTOMER_CHAT_MESSAGES_PER_WINDOW);
    // A window later the same visitor may write again.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + CUSTOMER_CHAT_WINDOW_MS + 1);
    await expect(
      sendCustomerChatMessage(deps, { ...chat, text: "back again" }),
    ).resolves.toMatchObject({
      visitorId: "visitor-1",
    });
    vi.useRealTimers();
  });

  it("shows the visitor their own words and the bot's, and nothing else", async () => {
    const { deps, storedMessages } = harness();
    const minted = await setCustomerChatLink(deps, {
      spaceId: "space-1",
      botId: "bot-1",
      userId: "user-1",
    });
    await sendCustomerChatMessage(deps, {
      token: minted.token,
      visitorId: "visitor-1",
      text: "hi",
    });
    storedMessages.push(
      { seq: 1, role: "user", blocks: [{ kind: "text", text: "hi" }], createdAt: new Date(0) },
      {
        seq: 2,
        role: "assistant",
        blocks: [{ kind: "text", text: "Hello! Here are the plans." }],
        createdAt: new Date(1_000),
      },
      {
        seq: 3,
        role: "assistant",
        blocks: [{ kind: "artifact", artifactId: "a" }],
        createdAt: new Date(2_000),
      },
    );
    await expect(
      listCustomerChatMessages(deps, { token: minted.token, visitorId: "visitor-1" }),
    ).resolves.toEqual({
      messages: [
        { seq: 1, role: "customer", text: "hi", at: new Date(0).toISOString() },
        {
          seq: 2,
          role: "bot",
          text: "Hello! Here are the plans.",
          at: new Date(1_000).toISOString(),
        },
      ],
    });
    // Another visitor's browser cannot read it, and a page asking again from seq 2 gets only the rest.
    await expect(
      listCustomerChatMessages(deps, { token: minted.token, visitorId: "someone-else" }),
    ).resolves.toEqual({ messages: [] });
    await expect(
      listCustomerChatMessages(deps, { token: minted.token, visitorId: "visitor-1", after: 1 }),
    ).resolves.toEqual({
      messages: [
        {
          seq: 2,
          role: "bot",
          text: "Hello! Here are the plans.",
          at: new Date(1_000).toISOString(),
        },
      ],
    });
  });
});
