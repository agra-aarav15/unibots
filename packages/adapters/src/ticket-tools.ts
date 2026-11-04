import type { TicketStatus } from "@rakazo/contracts";
import {
  CommentTicketInput,
  CreateTicketInput,
  isTicketCompletedStatus,
  parseTicketRef,
  TicketStatusSchema,
  UpdateTicketInput,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
  allocateTicketNumber,
  findTicket,
  listTicketComments,
  resolveBoard,
  toTicketCommentDto,
  toTicketDto,
} from "@rakazo/db";
import type { TicketChangeNotifier } from "./ticket-changes.js";

type TicketToolDeps = {
  prisma: PrismaClient;
  ticketBoardEnabled?: boolean;
  onTicketChange?: TicketChangeNotifier;
};

function ticketInputError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues
    .map(({ path, message }) => {
      const field =
        path[0] === "assigneeBotId" ? "ownerBotId" : path[0] === "ticketId" ? "id" : path.join(".");
      return field ? `${field}: ${message}` : message;
    })
    .join("; ");
}

const STATUS_ERROR = `status must be one of ${TicketStatusSchema.options.join(", ")}.`;
function coerceInputStatus(value: string) {
  const parsed = TicketStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
/**
 * An assignee must be one of the acting user's own bots, as the HTTP API
 * requires through `repos.getBot`. Assigning wakes the bot, which runs as its
 * owner, so another member's bot in the same space is not a valid target.
 */
async function ownBotInSpace(
  deps: TicketToolDeps,
  input: { spaceId: string; userId: string },
  botId: string,
) {
  return Boolean(
    await deps.prisma.bot.findFirst({
      where: { id: botId, spaceId: input.spaceId, userId: input.userId, archivedAt: null },
      select: { id: true },
    }),
  );
}
const LIST_TICKETS_LIMIT = 50;
const LIST_DESCRIPTION_CHARS = 200;

/**
 * The page key is the ticket's `createdAt` with `id` as the tiebreaker, because
 * both never change. A key on `updatedAt` would move a ticket that is edited
 * while a bot pages the board: the ticket would end up above the saved cursor
 * and no later page could return it. A stable key keeps the scan complete.
 */
function encodeTicketListCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

/**
 * Statuses where a bot is expected to be working. Moving a ticket into one of these is a
 * request for work, so it wakes the assignee exactly as a fresh assignment does.
 */
export function isWorkableTicketStatus(value: string): boolean {
  const parsed = TicketStatusSchema.safeParse(value);
  return parsed.success && (parsed.data === "todo" || parsed.data === "doing");
}

function decodeTicketListCursor(
  cursor: string,
): { createdAt: Date; id: string } | { error: string } {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return { error: "cursor is invalid." };
  }
  const split = raw.indexOf("|");
  if (split <= 0) return { error: "cursor is invalid." };
  const createdAt = new Date(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return { error: "cursor is invalid." };
  return { createdAt, id };
}

function truncateDescription(value: string | null | undefined) {
  if (!value || value.length <= LIST_DESCRIPTION_CHARS) return value;
  return `${value.slice(0, LIST_DESCRIPTION_CHARS - 1)}…`;
}

export async function listBoardTickets(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    boardId?: string;
    status?: string;
    assigneeBotId?: string;
    cursor?: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  let status: TicketStatus | undefined;
  if (input.status !== undefined) {
    status = coerceInputStatus(input.status);
    if (!status) return { error: STATUS_ERROR };
  }
  const cursor = input.cursor?.trim();
  let pageCursor: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    const decoded = decodeTicketListCursor(cursor);
    if ("error" in decoded) return decoded;
    pageCursor = decoded;
  }
  const board = await resolveBoard(deps.prisma, input.spaceId, input.boardId);
  if (!board) return { error: "Unknown board." };
  const rows = await deps.prisma.ticket.findMany({
    where: {
      spaceId: input.spaceId,
      boardId: board.id,
      // Closed tickets are history; they only show up when asked for by status.
      ...(status ? { status } : { status: { not: "closed" } }),
      ...(input.assigneeBotId ? { assigneeBotId: input.assigneeBotId } : {}),
      ...(pageCursor
        ? {
            OR: [
              { createdAt: { lt: pageCursor.createdAt } },
              { createdAt: pageCursor.createdAt, id: { lt: pageCursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_TICKETS_LIMIT + 1,
  });
  const page = rows.slice(0, LIST_TICKETS_LIMIT);
  const next = rows.length > LIST_TICKETS_LIMIT ? page.at(-1) : undefined;
  // A list is for scanning; ticket_get returns the full description.
  return {
    tickets: page.map((row) => {
      const dto = toTicketDto(row, board.ticketPrefix);
      return { ...dto, description: truncateDescription(dto.description) };
    }),
    ...(next ? { nextCursor: encodeTicketListCursor(next) } : {}),
  };
}

export async function getTicket(deps: TicketToolDeps, input: { spaceId: string; ref: string }) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const ref = input.ref.trim();
  if (!ref) return { error: "ref is required." };
  // A reference carries its board's prefix, so it says which board it sits on.
  const parsed = parseTicketRef(ref);
  const byPrefix = parsed
    ? await deps.prisma.board.findFirst({
        where: { spaceId: input.spaceId, ticketPrefix: parsed.prefix },
      })
    : null;
  const row =
    (byPrefix ? await findTicket(deps.prisma, input.spaceId, byPrefix, { ref }) : null) ??
    (await deps.prisma.ticket.findFirst({ where: { id: ref, spaceId: input.spaceId } }));
  if (!row) return { error: `Ticket ${ref} not found.` };
  const board =
    byPrefix?.id === row.boardId
      ? byPrefix
      : await deps.prisma.board.findFirstOrThrow({
          where: { id: row.boardId, spaceId: input.spaceId },
          select: { id: true, ticketPrefix: true },
        });
  const comments = await listTicketComments(deps.prisma, input.spaceId, row.id);
  return {
    ticket: toTicketDto(row, board.ticketPrefix),
    comments: comments.map(toTicketCommentDto),
  };
}

export async function createTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId: string;
    boardId?: string;
    title: string;
    description?: string;
    priority?: string;
    ownerBotId?: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = CreateTicketInput.safeParse({
    ...input,
    assigneeBotId: input.ownerBotId ?? input.botId,
  });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const data = parsed.data;
  if (!(await ownBotInSpace(deps, input, data.assigneeBotId))) return { error: "Unknown bot." };
  const board = await resolveBoard(deps.prisma, input.spaceId, input.boardId);
  if (!board) return { error: "Unknown board." };
  const row = await deps.prisma.$transaction(async (tx) => {
    const number = await allocateTicketNumber(tx, board.id);
    return tx.ticket.create({
      data: {
        boardId: board.id,
        spaceId: input.spaceId,
        number,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        assigneeBotId: data.assigneeBotId,
        createdByBotId: input.botId ?? null,
        createdByUserId: input.userId,
      },
    });
  });
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: board.id,
    ticketId: row.id,
    assigneeBotId: row.assigneeBotId,
    wakeAssignee: row.assigneeBotId !== input.botId,
  });
  return { ticket: toTicketDto(row, board.ticketPrefix) };
}

export async function updateTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId: string;
    id: string;
    boardId?: string;
    title?: string;
    description?: string | null;
    priority?: string | null;
    status?: string;
    ownerBotId?: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = UpdateTicketInput.safeParse({ ...input, assigneeBotId: input.ownerBotId });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const data = parsed.data;
  if (data.assigneeBotId && !(await ownBotInSpace(deps, input, data.assigneeBotId)))
    return { error: "Unknown bot." };
  // Addressing a board narrows the ticket; without one, any board in the workspace is fair game,
  // because a caller holding a ticket id (a bot in a comment, say) does not know the board.
  const board = input.boardId
    ? await resolveBoard(deps.prisma, input.spaceId, input.boardId)
    : null;
  if (input.boardId && !board) return { error: "Unknown board." };
  const result = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${data.id} AND "spaceId" = ${input.spaceId} FOR UPDATE`;
    const current = await tx.ticket.findFirst({
      where: {
        id: data.id,
        spaceId: input.spaceId,
        ...(board ? { boardId: board.id } : {}),
      },
    });
    if (!current) return null;
    const row = await tx.ticket.update({
      where: { id: current.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.priority !== undefined ? { priority: data.priority ?? "normal" } : {}),
        ...(data.assigneeBotId !== undefined ? { assigneeBotId: data.assigneeBotId } : {}),
        ...(data.status !== undefined
          ? {
              status: data.status,
              completedAt: isTicketCompletedStatus(data.status)
                ? (current.completedAt ?? new Date())
                : null,
            }
          : {}),
      },
    });
    return {
      row,
      previousStatus: current.status,
      reassigned: data.assigneeBotId !== undefined && data.assigneeBotId !== current.assigneeBotId,
    };
  });
  if (!result) return { error: "Ticket not found." };
  const ticketBoard =
    board?.id === result.row.boardId
      ? board
      : await deps.prisma.board.findFirstOrThrow({
          where: { id: result.row.boardId, spaceId: input.spaceId },
          select: { id: true, ticketPrefix: true },
        });
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: ticketBoard.id,
    ticketId: result.row.id,
    assigneeBotId: result.row.assigneeBotId,
    // A ticket that comes back into play is work again: a status change into an open state
    // wakes its owner just as an assignment does.
    wakeAssignee:
      (result.reassigned ||
        (result.row.status !== result.previousStatus &&
          isWorkableTicketStatus(result.row.status))) &&
      result.row.assigneeBotId !== input.botId,
  });
  return { ticket: toTicketDto(result.row, ticketBoard.ticketPrefix) };
}

export async function commentTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId?: string;
    id: string;
    boardId?: string;
    body: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = CommentTicketInput.safeParse({ ticketId: input.id, body: input.body });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const board = input.boardId
    ? await resolveBoard(deps.prisma, input.spaceId, input.boardId)
    : null;
  if (input.boardId && !board) return { error: "Unknown board." };
  // Without a board, the id is enough: a commenter knows the ticket, not where it sits.
  const ticket = board
    ? await findTicket(deps.prisma, input.spaceId, board, { id: input.id })
    : await deps.prisma.ticket.findFirst({
        where: { id: input.id, spaceId: input.spaceId },
      });
  if (!ticket) return { error: "Ticket not found." };
  const row = await deps.prisma.$transaction(async (tx) => {
    const comment = await tx.ticketComment.create({
      include: { authorBot: { select: { name: true } }, authorUser: { select: { name: true } } },
      data: {
        ticketId: ticket.id,
        spaceId: input.spaceId,
        authorBotId: input.botId ?? null,
        authorUserId: input.userId ?? null,
        body: parsed.data.body,
      },
    });
    await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
    return comment;
  });
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    assigneeBotId: ticket.assigneeBotId,
    wakeAssignee: false,
  });
  return { comment: toTicketCommentDto(row) };
}
