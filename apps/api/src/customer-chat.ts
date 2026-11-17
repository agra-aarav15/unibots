import {
  CUSTOMER_CHAT_LINK_UNKNOWN,
  CUSTOMER_CHAT_RATE_LIMITED,
  linkForCustomerChatToken,
  listCustomerChatMessages,
  newVisitorId,
  sendCustomerChatMessage,
} from "@unibot/adapters";
import type { PrismaClient, ThreadEvents } from "@unibot/db";
import { getLogger } from "@unibot/logging";
import { Hono } from "hono";

/** Where the visitor's browser keeps its place in the chat. Path-scoped to this page. */
export const CUSTOMER_CHAT_COOKIE = "unibot_customer_chat";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface CustomerChatRouteDeps {
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "sendUserMessage">;
  /** Secure cookies only where the page is actually served over https. */
  secureCookies: boolean;
}

function visitorIdFrom(header: string | undefined): string | undefined {
  const match = header?.match(
    new RegExp(`(?:^|;\\s*)${CUSTOMER_CHAT_COOKIE}=([A-Za-z0-9_-]{10,64})`),
  );
  return match?.[1];
}

function setVisitorCookie(secure: boolean) {
  return (visitorId: string) =>
    `${CUSTOMER_CHAT_COOKIE}=${visitorId}; Path=/api/v1/customer-chat; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

/**
 * The public page a customer talks to a bot on, and the two calls the page makes. Nothing here
 * reads a session: the link token is the whole credential, it names one bot, and a visitor only
 * ever sees their own conversation.
 */
export function customerChatRoutes(deps: CustomerChatRouteDeps) {
  const app = new Hono();
  const cookie = setVisitorCookie(deps.secureCookies);
  const chat = { prisma: deps.prisma, events: deps.events };
  const noStore = { "cache-control": "no-store" } as const;

  app.get("/api/v1/customer-chat/:token", async (c) => {
    const link = await linkForCustomerChatToken({ prisma: deps.prisma }, c.req.param("token"));
    if (!link) return c.body(null, 404);
    const bot = await deps.prisma.bot.findUnique({
      where: { id: link.botId },
      select: { name: true },
    });
    const visitorId = visitorIdFrom(c.req.header("cookie")) ?? newVisitorId();
    c.header("set-cookie", cookie(visitorId));
    c.header("content-type", "text/html; charset=utf-8");
    for (const [name, value] of Object.entries(noStore)) c.header(name, value);
    return c.body(
      customerChatPage({ botName: bot?.name ?? "Assistant", token: c.req.param("token") }),
    );
  });

  app.get("/api/v1/customer-chat/:token/messages", async (c) => {
    const visitorId = visitorIdFrom(c.req.header("cookie"));
    if (!visitorId) return c.json({ error: "Open the chat page first." }, 400, noStore);
    const after = Number(c.req.query("after") ?? 0);
    const result = await listCustomerChatMessages(chat, {
      token: c.req.param("token"),
      visitorId,
      after: Number.isFinite(after) ? after : 0,
    });
    if ("error" in result) return c.json(result, 404, noStore);
    return c.json(result, 200, noStore);
  });

  app.post("/api/v1/customer-chat/:token/messages", async (c) => {
    const visitorId = visitorIdFrom(c.req.header("cookie"));
    if (!visitorId) return c.json({ error: "Open the chat page first." }, 400, noStore);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    const result = await sendCustomerChatMessage(chat, {
      token: c.req.param("token"),
      visitorId,
      text: typeof body?.text === "string" ? body.text : "",
    });
    if ("error" in result) {
      const status =
        result.error === CUSTOMER_CHAT_LINK_UNKNOWN
          ? 404
          : result.error === CUSTOMER_CHAT_RATE_LIMITED
            ? 429
            : 400;
      if (status !== 429)
        getLogger().warn("customer chat message refused", { reason: result.error });
      return c.json(result, status, noStore);
    }
    return c.json({ ok: true as const, seq: result.seq }, 200, noStore);
  });

  return app;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[character] ?? character;
  });
}

/** A page with no build step and no session: it talks to the two calls above and nothing else. */
function customerChatPage(input: { botName: string; token: string }) {
  const name = escapeHtml(input.botName);
  const token = JSON.stringify(input.token).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 15px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
  header { display: flex; align-items: baseline; gap: 8px; padding: 14px 18px;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
  header strong { font-size: 15px; }
  header span { font-size: 12px; opacity: .6; }
  #log { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .turn { max-width: min(78%, 34rem); padding: 9px 13px; border-radius: 16px; white-space: pre-wrap;
    overflow-wrap: anywhere; }
  .bot { align-self: flex-start; background: color-mix(in srgb, currentColor 8%, transparent); }
  .customer { align-self: flex-end; background: color-mix(in srgb, currentColor 16%, transparent); }
  .ooops { align-self: center; font-size: 13px; opacity: .6; }
  form { display: flex; gap: 8px; padding: 12px 14px 6px; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
  textarea { flex: 1; resize: none; padding: 11px 13px; border-radius: 14px; font: inherit;
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent); background: transparent; color: inherit; }
  button { padding: 0 18px; border: 0; border-radius: 14px; font: inherit; font-weight: 600;
    background: currentColor; color: Canvas; }
  button:disabled { opacity: .5; }
  p { margin: 0; padding: 0 14px 12px; font-size: 12px; opacity: .55; text-align: center; }
</style>
</head>
<body>
<header><strong>${name}</strong><span>AI assistant</span></header>
<main id="log"></main>
<form id="composer"><textarea id="text" rows="1" maxlength="2000" placeholder="Write a message…"></textarea><button id="send" type="submit">Send</button></form>
<p>Replies are written by an AI assistant. Do not send card numbers, OTPs, or banking passwords.</p>
<script>
(function () {
  var log = document.getElementById("log"), form = document.getElementById("composer");
  var box = document.getElementById("text"), send = document.getElementById("send");
  var after = 0, waiting = false;
  function turn(role, text) {
    var line = document.createElement("div");
    line.className = "turn " + role;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    return line;
  }
  function oops(text) {
    var line = document.createElement("div");
    line.className = "ooops";
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  var thinking = null;
  function think(on) {
    if (on && !thinking) thinking = turn("bot", "…");
    if (!on && thinking) { thinking.remove(); thinking = null; }
  }
  function poll() {
    fetch("messages?after=" + after, { headers: { accept: "application/json" } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        var found = data.messages || [];
        for (var index = 0; index < found.length; index += 1) {
          var message = found[index];
          if (message.seq > after) after = message.seq;
          if (message.role === "bot") think(false);
          turn(message.role, message.text);
        }
        setTimeout(poll, found.length ? 400 : 1500);
      })
      .catch(function () { setTimeout(poll, 3000); });
  }
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = box.value.trim();
    if (!text || waiting) return;
    waiting = true;
    send.disabled = true;
    turn("customer", text);
    think(true);
    fetch("messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text })
    })
      .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok) { think(false); oops(result.data.error || "That did not send."); }
        else box.value = "";
      })
      .catch(function () { think(false); oops("That did not send. Check the connection."); })
      .finally(function () {
        waiting = false;
        send.disabled = false;
        box.focus();
      });
  });
  box.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  poll();
})();
</script>
</body>
</html>`;
}
