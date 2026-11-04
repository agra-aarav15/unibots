import type { JobPublisher } from "@rakazo/adapter-kit";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { wakeTicketAssignee } from "./ticket-wake.js";

/** How many tickets one pass picks up. Small on purpose: a pass runs every 30 seconds. */
const DEFAULT_SWEEP_LIMIT = 20;

/**
 * After this many failed runs the sweep stops retrying and blocks the ticket with a comment,
 * the way a person would. Without it a ticket whose work cannot run — a spent model quota, a
 * missing key — would be retried every thirty seconds forever.
 */
const MAX_FAILED_ATTEMPTS = 2;

const BLOCKED_BODY = [
  "⚠️ Blocked after two failed attempts. I have stopped retrying.",
  "",
  "Nothing was changed on this ticket. Someone needs to look at why the run failed before it is moved back to To do — the reason is on the run, not in my comment, so it is not repeated here.",
].join("\n");

/**
 * The Grinder's sweep: wakes the owner of any open ticket that nobody is working.
 *
 * Assignment alone is not enough in practice. A wake can be lost — the process restarts
 * between the write and the enqueue, the job is dropped, or the ticket is re-opened into
 * `doing` by a person — and then the ticket sits there forever with an owner and no run. The
 * sweep heals that: it looks for open, assigned tickets with no active run and wakes the owner
 * exactly as an assignment would.
 *
 * It runs on the reconciler's tick, which is leader-elected, so only one instance sweeps. The
 * per-ticket "is anyone already working this" check lives in `wakeTicketAssignee`, inside the
 * same transaction that creates the run, so a wake and a sweep cannot both start one.
 */
export async function sweepTicketWork(
  deps: { prisma: PrismaClient; jobs: JobPublisher; ticketBoardEnabled?: boolean },
  options: { limit?: number } = {},
): Promise<number> {
  if (!deps.ticketBoardEnabled) return 0;
  const tickets = await deps.prisma.ticket.findMany({
    where: {
      status: { in: ["todo", "doing"] },
      assigneeBotId: { not: null },
      runs: { none: { status: { in: [...ACTIVE_RUN_STATUSES] } } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: options.limit ?? DEFAULT_SWEEP_LIMIT,
    select: { id: true, spaceId: true, assigneeBotId: true },
  });

  let woken = 0;
  for (const ticket of tickets) {
    if (!ticket.assigneeBotId) continue;
    try {
      const failures = await deps.prisma.run.count({
        where: { spaceId: ticket.spaceId, ticketId: ticket.id, status: "failed" },
      });
      if (failures >= MAX_FAILED_ATTEMPTS) {
        await blockTicket(deps, ticket);
        continue;
      }
      const runId = await wakeTicketAssignee(deps, {
        spaceId: ticket.spaceId,
        ticketId: ticket.id,
        botId: ticket.assigneeBotId,
      });
      if (runId) woken += 1;
    } catch (error) {
      // One ticket failing must not stop the rest of the pass.
      getLogger().warn("ticket sweep wake failed", { ticketId: ticket.id, error });
    }
  }
  return woken;
}

/** Moves the ticket out of play and says so once. Left in the workspace's own hands after that. */
async function blockTicket(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  ticket: { id: string; spaceId: string },
): Promise<void> {
  await deps.prisma.$transaction(async (tx) => {
    // Only a ticket still in play is moved, so a person moving it back is not overruled twice.
    const moved = await tx.ticket.updateMany({
      where: { id: ticket.id, spaceId: ticket.spaceId, status: { in: ["todo", "doing"] } },
      data: { status: "blocked" },
    });
    if (moved.count !== 1) return;
    await tx.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: ticket.spaceId,
        authorBotId: null,
        authorUserId: null,
        body: BLOCKED_BODY,
      },
    });
  });
}