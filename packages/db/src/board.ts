import type { Board, Ticket, TicketComment, TicketPriority, TicketStatus } from "@rakazo/contracts";
import {
  parseTicketRef,
  TicketPrioritySchema,
  TicketStatusSchema,
  ticketRef,
} from "@rakazo/contracts";
import type {
  Board as BoardRow,
  Prisma,
  PrismaClient,
  TicketComment as TicketCommentRow,
  Ticket as TicketRow,
} from "./client.js";

/** A unique constraint rejected the write: the row already exists. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/**
 * The workspace's default board: the one created first. A workspace starts with exactly one,
 * which is what every existing caller means by "the board"; further boards are addressed by id.
 * skipDuplicates tolerates concurrent first opens without aborting their transactions.
 */
export async function ensureBoard(prisma: PrismaClient, spaceId: string): Promise<BoardRow> {
  const existing = await defaultBoard(prisma, spaceId);
  if (existing) return existing;
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { name: true },
  });
  const name = space?.name.trim() || "Board";
  // A workspace can hold several boards now, so `skipDuplicates` no longer has a per-space
  // unique key to lean on: the loser of a concurrent first open hits the default prefix that
  // the winner just took. That is the race resolving, not an error, so read the winner's board.
  try {
    await prisma.board.createMany({ data: [{ spaceId, name }], skipDuplicates: true });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return prisma.board.findFirstOrThrow({
    where: { spaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function defaultBoard(
  prisma: Pick<PrismaClient, "board">,
  spaceId: string,
): Promise<BoardRow | null> {
  return prisma.board.findFirst({
    where: { spaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** A named board in the workspace. The prefix must be unique there, or references would clash. */
export async function createBoard(
  prisma: PrismaClient,
  spaceId: string,
  input: { name: string; ticketPrefix: string },
): Promise<BoardRow> {
  return prisma.board.create({
    data: { spaceId, name: input.name, ticketPrefix: input.ticketPrefix.toUpperCase() },
  });
}

export async function listBoards(prisma: PrismaClient, spaceId: string): Promise<BoardRow[]> {
  return prisma.board.findMany({
    where: { spaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * The board a caller addressed, or the workspace's default board when none was named.
 * Null means the id belongs to another workspace or does not exist.
 */
export async function resolveBoard(
  prisma: PrismaClient,
  spaceId: string,
  boardId?: string | null,
): Promise<BoardRow | null> {
  if (!boardId) return ensureBoard(prisma, spaceId);
  return prisma.board.findFirst({ where: { id: boardId, spaceId } });
}

/**
 * The board's counter is incremented in the same transaction as the insert, so
 * concurrent creates get distinct ascending numbers.
 */
export async function allocateTicketNumber(
  tx: Pick<Prisma.TransactionClient, "board">,
  boardId: string,
): Promise<number> {
  const incremented = await tx.board.update({
    where: { id: boardId },
    data: { nextNumber: { increment: 1 } },
    select: { nextNumber: true },
  });
  return incremented.nextNumber - 1;
}

export async function findTicket(
  prisma: PrismaClient,
  spaceId: string,
  board: { id: string; ticketPrefix: string },
  input: { id?: string; ref?: string },
): Promise<TicketRow | null> {
  if (input.id) {
    return prisma.ticket.findFirst({
      where: { id: input.id, spaceId, boardId: board.id },
    });
  }
  const parsed = input.ref ? parseTicketRef(input.ref, board.ticketPrefix) : null;
  if (!parsed) return null;
  return prisma.ticket.findFirst({
    where: { number: parsed.number, spaceId, boardId: board.id },
  });
}

export function toBoardDto(row: BoardRow): Board {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    ticketPrefix: row.ticketPrefix,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Unknown or legacy status strings fall back to `todo`, so an old row still renders. */
export function coerceTicketStatus(value: string): TicketStatus {
  const parsed = TicketStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : "todo";
}

/** Legacy free-text priorities fall back to `normal` so old rows keep rendering. */
function coerceTicketPriority(value: string | null | undefined): TicketPriority {
  const parsed = TicketPrioritySchema.safeParse(typeof value === "string" ? value.trim() : value);
  return parsed.success ? parsed.data : "normal";
}

export function toTicketDto(row: TicketRow, ticketPrefix: string): Ticket {
  return {
    id: row.id,
    boardId: row.boardId,
    spaceId: row.spaceId,
    number: row.number,
    ref: ticketRef(ticketPrefix, row.number),
    title: row.title,
    description: row.description,
    status: coerceTicketStatus(row.status),
    priority: coerceTicketPriority(row.priority),
    assigneeBotId: row.assigneeBotId,
    createdByBotId: row.createdByBotId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export async function listTicketComments(
  prisma: Pick<PrismaClient, "ticketComment">,
  spaceId: string,
  ticketId: string,
) {
  return prisma.ticketComment.findMany({
    where: { ticketId, spaceId },
    include: { authorBot: { select: { name: true } }, authorUser: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function toTicketCommentDto(
  row: TicketCommentRow & {
    authorBot: { name: string } | null;
    authorUser: { name: string } | null;
  },
): TicketComment {
  return {
    id: row.id,
    ticketId: row.ticketId,
    body: row.body,
    authorBotId: row.authorBotId,
    authorUserId: row.authorUserId,
    authorName: row.authorBot?.name ?? row.authorUser?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
