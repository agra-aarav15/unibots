import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import { isTicketCompletedStatus, TicketStatusSchema } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/**
 * Assignment wakes only its current owner, without posting a chat message. Returns the new run
 * id, or null when there was nothing to do — the ticket is closed, unassigned, or its owner is
 * already working it.
 */
export async function wakeTicketAssignee(
  deps: { prisma: PrismaClient; jobs: JobPublisher; ticketBoardEnabled?: boolean },
  input: { spaceId: string; ticketId: string; botId: string },
): Promise<string | null> {
  if (!deps.ticketBoardEnabled) return null;
  const run = await deps.prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, spaceId: input.spaceId, assigneeBotId: input.botId },
      include: { board: { select: { ticketPrefix: true } } },
    });
    if (!ticket) return null;
    const status = TicketStatusSchema.safeParse(ticket.status);
    if (!status.success || isTicketCompletedStatus(status.data)) return null;
    const bot = await tx.bot.findFirst({
      where: { id: input.botId, spaceId: input.spaceId, archivedAt: null },
      select: { id: true, userId: true, thread: { select: { id: true } } },
    });
    if (!bot?.thread) return null;
    // One ticket, one run at a time: a wake that arrives while the owner is already working
    // this ticket would queue the same work twice.
    const alreadyWorking = await tx.run.findFirst({
      where: {
        spaceId: input.spaceId,
        ticketId: ticket.id,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      select: { id: true },
    });
    if (alreadyWorking) return null;
    const task = await tx.task.create({
      data: {
        spaceId: input.spaceId,
        botId: bot.id,
        threadId: bot.thread.id,
        userId: bot.userId,
        prompt: `Work on ticket ${ticket.board.ticketPrefix}-${ticket.number}. Read it with ticket_get. Keep progress in ticket comments and update its status with ticket_update. Use ask or approval cards when user input is needed.`,
        status: "queued",
      },
    });
    return tx.run.create({
      data: {
        spaceId: input.spaceId,
        botId: bot.id,
        threadId: bot.thread.id,
        userId: bot.userId,
        taskId: task.id,
        ticketId: ticket.id,
        trigger: "tickets",
        status: "queued",
      },
    });
  });
  if (!run) return null;
  await deps.jobs.enqueue(runContinueJob(run.id)).catch((error) => {
    getLogger().warn("ticket wake deferred to reconciliation", error);
  });
  return run.id;
}
