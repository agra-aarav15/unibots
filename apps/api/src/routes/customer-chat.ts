import { getCustomerChatLink, revokeCustomerChatLink, setCustomerChatLink } from "@unibot/adapters";
import type { Actor } from "@unibot/contracts";
import type { RouterContext } from "./context.js";

/** Where the customer's browser goes. Kept a path so the owner shares whatever origin they use. */
export function customerChatLinkPath(token: string) {
  return `/api/v1/customer-chat/${token}`;
}

export function customerChatRoutes(ctx: RouterContext) {
  const { deps, repos, authed } = ctx;

  /** The owner's view of a bot's public page, so the app can show or copy the live link. */
  async function view(actor: Actor, botId: string) {
    const bot = await repos.getBot(actor, botId);
    const link = await getCustomerChatLink(deps, { spaceId: bot.spaceId, botId: bot.id });
    const chats = link ? await deps.prisma.customerChat.count({ where: { linkId: link.id } }) : 0;
    return {
      path: link && !link.revokedAt ? customerChatLinkPath(link.token) : null,
      createdAt: link ? link.createdAt.toISOString() : null,
      revokedAt: link?.revokedAt ? link.revokedAt.toISOString() : null,
      chats,
    };
  }

  return {
    customerChat: {
      status: authed.customerChat.status.handler(async ({ context, input }) =>
        view(context.actor, input.botId),
      ),
      rotate: authed.customerChat.rotate.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        await setCustomerChatLink(deps, {
          spaceId: bot.spaceId,
          botId: bot.id,
          userId: context.actor.userId,
        });
        return view(context.actor, bot.id);
      }),
      revoke: authed.customerChat.revoke.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        await revokeCustomerChatLink(deps, { spaceId: bot.spaceId, botId: bot.id });
        return view(context.actor, bot.id);
      }),
    },
  };
}
