import { ORPCError } from "@orpc/server";
import { commentTicket, createTicket, updateTicket } from "@rakazo/adapters";
import type { BoardEvent } from "@rakazo/contracts";
import { parseTicketRef } from "@rakazo/contracts";
import { escapeSearchWildcards } from "@rakazo/core";
import type { Board as BoardRow, Prisma, PrismaClient } from "@rakazo/db";
import {
  createBoard,
  ensureBoard,
  findTicket,
  IsolationError,
  listBoards,
  listTicketComments,
  resolveBoard,
  toBoardDto,
  toTicketCommentDto,
  toTicketDto,
} from "@rakazo/db";
import type { RouterContext } from "./context.js";
import { HEARTBEAT_MS, SESSION_RECHECK_MS } from "./shared.js";

/** The board a request addressed, or the workspace's default one when it named none. */
async function requireBoard(prisma: PrismaClient, spaceId: string, boardId?: string) {
  const board = await resolveBoard(prisma, spaceId, boardId);
  if (!board) throw new ORPCError("BAD_REQUEST", { message: "Unknown board." });
  return board;
}

/** A prefix is unique inside its workspace, so a second board cannot take a used one. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

const PREFIX_TAKEN = "That prefix is already used in this workspace.";

export function boardsRoutes(ctx: RouterContext) {
  const { deps, repos, boardEnabled, ticketDeps } = ctx;
  return {
    boards: {
      list: boardEnabled.boards.list.handler(async ({ context }) => {
        await ensureBoard(deps.prisma, context.actor.spaceId);
        const rows = await listBoards(deps.prisma, context.actor.spaceId);
        return rows.map(toBoardDto);
      }),
      get: boardEnabled.boards.get.handler(async ({ context }) => {
        const board = await ensureBoard(deps.prisma, context.actor.spaceId);
        return toBoardDto(board);
      }),
      create: boardEnabled.boards.create.handler(async ({ context, input }) => {
        const spaceId = context.actor.spaceId;
        // A workspace always has a default board, so its first board is never renamed into one.
        await ensureBoard(deps.prisma, spaceId);
        try {
          return toBoardDto(await createBoard(deps.prisma, spaceId, input));
        } catch (error) {
          if (isUniqueViolation(error)) throw new ORPCError("BAD_REQUEST", { message: PREFIX_TAKEN });
          throw error;
        }
      }),
      rename: boardEnabled.boards.rename.handler(async ({ context, input }) => {
        const board = await requireBoard(deps.prisma, context.actor.spaceId, input.boardId);
        const nextPrefix = input.ticketPrefix?.toUpperCase();
        const changesPrefix = nextPrefix !== undefined && nextPrefix !== board.ticketPrefix;
        if (changesPrefix) {
          const tickets = await deps.prisma.ticket.count({
            where: { boardId: board.id, spaceId: context.actor.spaceId },
          });
          if (tickets > 0) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Cannot change the ticket prefix once tickets exist.",
            });
          }
        }
        // Only a changed prefix is written: replaying a case-only value could
        // restore a prefix that a concurrent rename already replaced.
        const data = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(changesPrefix ? { ticketPrefix: nextPrefix } : {}),
        };
        let row: BoardRow;
        try {
          if (changesPrefix) {
            // The write itself must still require an empty board: createTicket
            // commits its first insert after this count ran, so only this check
            // stops the prefix from retroactively changing existing ticket refs.
            // nextNumber closes the lock-wait gap: createTicket's transaction
            // increments this same row, and Postgres rechecks a scalar predicate
            // against the committed row, while the tickets subquery can keep its
            // pre-wait snapshot and miss the inserted ticket.
            const [updated] = await deps.prisma.board.updateManyAndReturn({
              where: {
                id: board.id,
                spaceId: context.actor.spaceId,
                nextNumber: board.nextNumber,
                tickets: { none: {} },
              },
              data,
            });
            if (!updated) {
              throw new ORPCError("BAD_REQUEST", {
                message: "Cannot change the ticket prefix once tickets exist.",
              });
            }
            row = updated;
          } else {
            row = await deps.prisma.board.update({ where: { id: board.id }, data });
          }
        } catch (error) {
          if (isUniqueViolation(error)) throw new ORPCError("BAD_REQUEST", { message: PREFIX_TAKEN });
          throw error;
        }
        return toBoardDto(row);
      }),
      subscribe: boardEnabled.boards.subscribe.handler(async function* ({ context }) {
        const spaceId = context.actor.spaceId;
        const follow = deps.boardEvents.follow(spaceId, context.signal);
        // Board signals are transient, so a heartbeat stands in for liveness and
        // gives the client a periodic catch-up reload if a push was missed.
        let pending: Promise<IteratorResult<BoardEvent>> | undefined;
        let authorizedAt = Date.now();
        const assertStillAuthorized = async () => {
          if (!context.stillAuthorized || Date.now() - authorizedAt < SESSION_RECHECK_MS) return;
          if (!(await context.stillAuthorized())) throw new ORPCError("UNAUTHORIZED");
          authorizedAt = Date.now();
        };
        try {
          while (!context.signal?.aborted) {
            pending ??= follow.next();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const next = await Promise.race([
              pending,
              new Promise<"silent">((resolve) => {
                timer = setTimeout(() => resolve("silent"), HEARTBEAT_MS);
              }),
            ]).finally(() => clearTimeout(timer));
            await assertStillAuthorized();
            if (next === "silent") {
              yield { spaceId, createdAt: new Date().toISOString() };
              continue;
            }
            pending = undefined;
            if (next.done) return;
            yield next.value;
          }
        } finally {
          void follow.return(undefined).catch(() => {});
        }
      }),
    },
    tickets: {
      list: boardEnabled.tickets.list.handler(async ({ context, input }) => {
        const board = await requireBoard(deps.prisma, context.actor.spaceId, input.boardId);
        const q = input.q?.trim();
        // The database side has to match the text the user typed: a `%` or `_`
        // would otherwise widen the match, and a `\` would swallow the
        // character after it.
        const likeQ = q ? escapeSearchWildcards(q) : q;
        const where: Prisma.TicketWhereInput = {
          spaceId: context.actor.spaceId,
          boardId: board.id,
          ...(input.status ? { status: input.status } : {}),
          ...(input.assigneeBotId ? { assigneeBotId: input.assigneeBotId } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: likeQ, mode: "insensitive" } },
                  { description: { contains: likeQ, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const rows = await deps.prisma.ticket.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        });
        return { tickets: rows.map((row) => toTicketDto(row, board.ticketPrefix)) };
      }),
      get: boardEnabled.tickets.get.handler(async ({ context, input }) => {
        const spaceId = context.actor.spaceId;
        let board = await requireBoard(deps.prisma, spaceId, input.boardId);
        // A reference carries its board's prefix, so it identifies the board by itself.
        if (!input.boardId && input.ref) {
          const parsed = parseTicketRef(input.ref);
          const byPrefix = parsed
            ? await deps.prisma.board.findFirst({
                where: { spaceId, ticketPrefix: parsed.prefix },
              })
            : null;
          if (byPrefix) board = byPrefix;
        }
        const row = await findTicket(deps.prisma, spaceId, board, input);
        if (!row) {
          if (input.ref && !parseTicketRef(input.ref)) {
            throw new ORPCError("BAD_REQUEST", { message: "Invalid ticket reference." });
          }
          throw new IsolationError();
        }
        return toTicketDto(row, board.ticketPrefix);
      }),
      create: boardEnabled.tickets.create.handler(async ({ context, input }) => {
        const board = await requireBoard(deps.prisma, context.actor.spaceId, input.boardId);
        await repos.getBot(context.actor, input.assigneeBotId);
        const result = await createTicket(ticketDeps, {
          ...input,
          boardId: board.id,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          ownerBotId: input.assigneeBotId,
        });
        if ("error" in result) throw new ORPCError("BAD_REQUEST", { message: result.error });
        return result.ticket;
      }),
      update: boardEnabled.tickets.update.handler(async ({ context, input }) => {
        if (input.assigneeBotId) await repos.getBot(context.actor, input.assigneeBotId);
        const result = await updateTicket(ticketDeps, {
          ...input,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          ownerBotId: input.assigneeBotId,
        });
        if ("error" in result) throw new ORPCError("BAD_REQUEST", { message: result.error });
        return result.ticket;
      }),
      move: boardEnabled.tickets.move.handler(async ({ context, input }) => {
        const result = await updateTicket(ticketDeps, {
          ...input,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
        });
        if ("error" in result) throw new ORPCError("BAD_REQUEST", { message: result.error });
        return result.ticket;
      }),
      comment: boardEnabled.tickets.comment.handler(async ({ context, input }) => {
        const result = await commentTicket(ticketDeps, {
          id: input.ticketId,
          boardId: input.boardId,
          body: input.body,
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
        });
        if ("error" in result) throw new ORPCError("BAD_REQUEST", { message: result.error });
        return result.comment;
      }),
      comments: boardEnabled.tickets.comments.handler(async ({ context, input }) => {
        // The space is the boundary here; the board adds nothing a ticket id does not already say.
        const ticket = await deps.prisma.ticket.findFirst({
          where: { id: input.ticketId, spaceId: context.actor.spaceId },
        });
        if (!ticket) throw new IsolationError();
        const rows = await listTicketComments(deps.prisma, context.actor.spaceId, ticket.id);
        return rows.map(toTicketCommentDto);
      }),
    },
  };
}
