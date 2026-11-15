import { ORPCError } from "@orpc/server";
import {
  commentTicket,
  decidePaymentRequest,
  formatAmountMinor,
  getPaymentPayee,
  listPaymentRequests,
  PAYMENT_NOT_PENDING,
  PAYMENT_PAYEE_MISSING,
  PAYMENT_UNKNOWN,
  setPaymentPayee,
  updateTicket,
} from "@unibot/adapters";
import type { Actor } from "@unibot/contracts";
import { getLogger } from "@unibot/logging";
import type { RouterContext } from "./context.js";

/** The refusals a caller can act on, surfaced as a bad request instead of an opaque 500. */
const PAYMENT_ERRORS = new Set([PAYMENT_PAYEE_MISSING, PAYMENT_NOT_PENDING, PAYMENT_UNKNOWN]);

function asBadRequest(error: unknown): never {
  if (error instanceof Error && PAYMENT_ERRORS.has(error.message)) {
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  }
  throw error;
}

/** Setting the address money lands in is the owner's call, not any member's. */
async function requireSpaceOwner(deps: RouterContext["deps"], actor: Actor): Promise<void> {
  const membership = await deps.prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: { role: true },
  });
  if (membership?.role !== "owner") {
    throw new ORPCError("FORBIDDEN", { message: "Only a space owner can set the payment address." });
  }
}

export function paymentRoutes(ctx: RouterContext) {
  const { deps, authed, ticketDeps } = ctx;

  /**
   * The owner's decision on a request. A verified deal also wakes the bot that owns the deal
   * ticket, so it can thank the customer and deliver without the owner relaying anything. A failed
   * wake is logged, never fatal: the money is confirmed either way.
   */
  async function decide(
    actor: Actor,
    input: { id: string; note?: string },
    status: "verified" | "rejected" | "cancelled",
  ) {
    const request = await decidePaymentRequest(deps, {
      spaceId: actor.spaceId,
      id: input.id,
      userId: actor.userId,
      status,
      note: input.note,
    });
    if (status === "verified" && request.ticketId && deps.env?.ticketBoardEnabled) {
      const amount = formatAmountMinor(request.amountMinor, request.currency);
      const body = request.note
        ? `Payment verified: ${request.reference} (${amount}) — ${request.note}`
        : `Payment verified: ${request.reference} (${amount}).`;
      try {
        const commented = await commentTicket(ticketDeps, {
          id: request.ticketId,
          spaceId: actor.spaceId,
          userId: actor.userId,
          body,
        });
        if ("error" in commented) {
          getLogger().warn("payment verified but the ticket comment failed", {
            error: commented.error,
          });
        }
        const moved = await updateTicket(ticketDeps, {
          id: request.ticketId,
          spaceId: actor.spaceId,
          userId: actor.userId,
          status: "doing",
        });
        if ("error" in moved) {
          getLogger().warn("payment verified but waking the ticket failed", { error: moved.error });
        }
      } catch (error) {
        getLogger().error("payment verified but waking the ticket threw", error);
      }
    }
    return request;
  }

  const settle = (actor: Actor, input: { id: string; note?: string }, status: "verified" | "rejected" | "cancelled") =>
    decide(actor, input, status).catch((error: unknown) => asBadRequest(error));

  return {
    payments: {
      list: authed.payments.list.handler(async ({ context, input }) => ({
        requests: await listPaymentRequests(deps, {
          spaceId: context.actor.spaceId,
          status: input.status,
        }),
      })),
      verify: authed.payments.verify.handler(({ context, input }) =>
        settle(context.actor, input, "verified"),
      ),
      reject: authed.payments.reject.handler(({ context, input }) =>
        settle(context.actor, input, "rejected"),
      ),
      cancel: authed.payments.cancel.handler(({ context, input }) =>
        settle(context.actor, input, "cancelled"),
      ),
      payee: authed.payments.payee.handler(({ context }) =>
        getPaymentPayee(deps, context.actor.spaceId),
      ),
      setPayee: authed.payments.setPayee.handler(async ({ context, input }) => {
        await requireSpaceOwner(deps, context.actor);
        return setPaymentPayee(deps, { spaceId: context.actor.spaceId, payeeId: input.payeeId });
      }),
    },
  };
}
