import { describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({
  linkForCustomerChatToken: vi.fn(),
  sendCustomerChatMessage: vi.fn(),
  listCustomerChatMessages: vi.fn(),
}));

vi.mock("@unibot/adapters", () => ({
  CUSTOMER_CHAT_LINK_UNKNOWN: "This chat link is not valid any more.",
  CUSTOMER_CHAT_RATE_LIMITED: "That is a lot of messages. Try again a little later.",
  linkForCustomerChatToken: page.linkForCustomerChatToken,
  sendCustomerChatMessage: page.sendCustomerChatMessage,
  listCustomerChatMessages: page.listCustomerChatMessages,
  newVisitorId: () => "visitor-new",
}));

const { CUSTOMER_CHAT_COOKIE, customerChatRoutes } = await import("./customer-chat.js");

const links = { findUnique: vi.fn(async () => ({ id: "bot-1", name: "Sales" })) };
const app = customerChatRoutes({
  prisma: {
    bot: { findUnique: async () => ({ name: "Sales" }) },
    customerChatLink: links,
  } as never,
  events: { sendUserMessage: vi.fn() } as never,
  secureCookies: false,
});

const visitorId = "visitor-0123456789";
const browser = { cookie: `${CUSTOMER_CHAT_COOKIE}=${visitorId}` };

describe("the public customer chat page", () => {
  it("serves the page with the bot's name, a cookie, and no caching", async () => {
    page.linkForCustomerChatToken.mockResolvedValue({ id: "link-1", botId: "bot-1" });
    const response = await app.request("/api/v1/customer-chat/token-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(`${CUSTOMER_CHAT_COOKIE}=`);
    const html = await response.text();
    expect(html).toContain("<strong>Sales</strong>");
    expect(html).toContain("AI assistant");
  });

  it("does not leak a hostile bot name into the page", async () => {
    page.linkForCustomerChatToken.mockResolvedValue({ id: "link-1", botId: "bot-1" });
    const hostile = customerChatRoutes({
      prisma: {
        bot: { findUnique: async () => ({ name: '<img src=x onerror="alert(1)">' }) },
        customerChatLink: links,
      } as never,
      events: { sendUserMessage: vi.fn() } as never,
      secureCookies: false,
    });
    const html = await (await hostile.request("/api/v1/customer-chat/token-1")).text();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("answers 404 for a link that is gone", async () => {
    page.linkForCustomerChatToken.mockResolvedValue(null);
    expect((await app.request("/api/v1/customer-chat/gone")).status).toBe(404);
  });

  it("refuses a message from a browser that never opened the page", async () => {
    const response = await app.request("/api/v1/customer-chat/token-1/messages", {
      method: "POST",
      body: JSON.stringify({ text: "hi" }),
    });
    expect(response.status).toBe(400);
    expect(page.sendCustomerChatMessage).not.toHaveBeenCalled();
  });

  it("passes the visitor's message on and answers with no-store", async () => {
    page.sendCustomerChatMessage.mockResolvedValue({ visitorId, seq: 4 });
    const response = await app.request("/api/v1/customer-chat/token-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browser.cookie },
      body: JSON.stringify({ text: "how much?" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, seq: 4 });
    expect(page.sendCustomerChatMessage).toHaveBeenCalledWith(expect.anything(), {
      token: "token-1",
      visitorId,
      text: "how much?",
    });
  });

  it.each([
    ["This chat link is not valid any more.", 404],
    ["That is a lot of messages. Try again a little later.", 429],
    ["Write a message first.", 400],
  ])("turns %j into a %i", async (error, status) => {
    page.sendCustomerChatMessage.mockResolvedValue({ error });
    const response = await app.request("/api/v1/customer-chat/token-1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: browser.cookie },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("hands the page only what this visitor's cookie has already seen up to", async () => {
    page.listCustomerChatMessages.mockResolvedValue({
      messages: [{ seq: 3, role: "bot", text: "Yes, it is 499.", at: "2026-11-17T00:00:00.000Z" }],
    });
    const response = await app.request("/api/v1/customer-chat/token-1/messages?after=2", {
      headers: { accept: "application/json", cookie: browser.cookie },
    });
    expect(response.status).toBe(200);
    expect(page.listCustomerChatMessages).toHaveBeenCalledWith(expect.anything(), {
      token: "token-1",
      visitorId,
      after: 2,
    });
    expect(await response.json()).toMatchObject({ messages: [{ seq: 3, role: "bot" }] });
  });
});
