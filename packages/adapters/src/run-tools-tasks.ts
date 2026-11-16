import {
  desktopProtectionGuardMessage,
  protectedComputerLifecycleRefusal,
} from "./desktop-command-guard.js";
import {
  createPaymentRequest,
  formatAmountMinor,
  listPaymentRequests,
  PAYMENT_PAYEE_MISSING,
  PAYMENT_UNKNOWN_TICKET,
} from "./payment-requests.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import {
  cancelScheduleFromTool,
  commandWatchFromTool,
  compactScheduleInput,
  createScheduleFromTool,
  isScheduleValueProvided,
  listSchedulesFromTool,
  updateScheduleFromTool,
} from "./schedule-tools.js";
import {
  addScratchpadItemFromTool,
  completeScratchpadItemFromTool,
  listScratchpadItemsFromTool,
  removeScratchpadItemFromTool,
  updateScratchpadItemFromTool,
} from "./scratchpad-tools.js";
import {
  skillCreateFromTool,
  skillDeleteFromTool,
  skillReadFromTool,
  skillUpdateFromTool,
} from "./skill-tools.js";
import { taskCatalogFromTool } from "./task-catalog.js";
import {
  commentTicket,
  createTicket,
  getTicket,
  listBoardTickets,
  updateTicket,
} from "./ticket-tools.js";

/** The task catalog, scratchpad, ticket board, schedules and skills. */
export const taskTools: ToolHandlers = {
  async task_catalog(ctx) {
    const { deps, run, bot, thread } = ctx;
    return taskCatalogFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(thread.groupId ? { threadId: thread.id } : {}),
      tools: ctx.tools.offered,
    });
  },
  async scratchpad_list(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return listScratchpadItemsFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      includeDone: Boolean(args.includeDone),
    });
  },
  async scratchpad_add(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const created = await addScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      title: String(args.title ?? ""),
      status: args.status ? String(args.status) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
    });
    return call.finish(created);
  },
  async scratchpad_update(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const updated = await updateScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
      title: args.title !== undefined ? String(args.title) : undefined,
      status: args.status !== undefined ? String(args.status) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
    });
    return call.finish(updated);
  },
  async scratchpad_complete(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const completed = await completeScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
    });
    return call.finish(completed);
  },
  async scratchpad_remove(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const removed = await removeScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
    });
    return call.finish(removed);
  },
  async board_tickets(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await listBoardTickets(deps, {
        spaceId: run.spaceId,
        status: args.status !== undefined ? String(args.status) : undefined,
        assigneeBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
        cursor: args.cursor !== undefined ? String(args.cursor) : undefined,
      }),
    );
  },
  async ticket_get(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await getTicket(deps, {
        spaceId: run.spaceId,
        ref: String(args.ref ?? ""),
      }),
    );
  },
  async ticket_create(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await createTicket(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        title: String(args.title ?? ""),
        description: args.description !== undefined ? String(args.description) : undefined,
        priority: args.priority !== undefined ? String(args.priority) : undefined,
        ownerBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
      }),
    );
  },
  async ticket_update(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await updateTicket(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        id: String(args.id ?? ""),
        title: args.title !== undefined ? String(args.title) : undefined,
        description: args.description !== undefined ? String(args.description) : undefined,
        priority: args.priority !== undefined ? String(args.priority) : undefined,
        status: args.status !== undefined ? String(args.status) : undefined,
        ownerBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
      }),
    );
  },
  async ticket_comment(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await commentTicket(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        id: String(args.id ?? ""),
        body: String(args.body ?? ""),
      }),
    );
  },
  async request_payment(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return call.finish({ error: "Enter a positive amount." });
    }
    const currency =
      args.currency !== undefined ? String(args.currency).trim().toUpperCase() : undefined;
    const request = await createPaymentRequest(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      amountMinor: Math.round(amount * 100),
      ...(currency ? { currency } : {}),
      ...(args.description !== undefined ? { description: String(args.description) } : {}),
      ...(args.customer !== undefined ? { customer: String(args.customer) } : {}),
      ...(args.ticketId !== undefined ? { ticketId: String(args.ticketId) } : {}),
    }).catch((error: unknown) => {
      if (
        error instanceof Error &&
        (error.message === PAYMENT_PAYEE_MISSING || error.message === PAYMENT_UNKNOWN_TICKET)
      ) {
        return { error: error.message };
      }
      throw error;
    });
    if ("error" in request) return call.finish(request);
    const shown = formatAmountMinor(request.amountMinor, request.currency);
    return call.finish({
      reference: request.reference,
      payeeId: request.payeeId,
      amount: shown,
      amountMinor: request.amountMinor,
      currency: request.currency,
      status: request.status,
      tellTheCustomer: `Ask them to pay ${shown} to ${request.payeeId}, quoting ${request.reference}.`,
    });
  },
  async payment_status(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    const reference = args.reference !== undefined ? String(args.reference) : undefined;
    const ticketId = args.ticketId !== undefined ? String(args.ticketId) : undefined;
    const requests = await listPaymentRequests(deps, {
      spaceId: run.spaceId,
      ...(reference ? { reference } : {}),
      ...(ticketId ? { ticketId } : {}),
    });
    return call.finish({
      payments: requests.map((request) => ({
        reference: request.reference,
        status: request.status,
        amount: formatAmountMinor(request.amountMinor, request.currency),
        payeeId: request.payeeId,
        verifiedAt: request.verifiedAt,
      })),
    });
  },
  async schedule_create(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const command = commandWatchFromTool(args.watch);
    const refusal = command === undefined ? undefined : protectedComputerLifecycleRefusal(command);
    if (ctx.computer.lifecycleGuarded && refusal)
      return call.finish({ error: desktopProtectionGuardMessage(refusal) });
    const created = await createScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      threadId: thread.id,
      name: String(args.name ?? ""),
      prompt: String(args.prompt ?? ""),
      timezone: args.timezone ? String(args.timezone) : undefined,
      schedule: compactScheduleInput({
        cron: args.cron,
        every: args.every,
        unit: args.unit,
        runAt: args.runAt,
        delayMinutes: args.delayMinutes,
        delaySeconds: args.delaySeconds,
        startAt: args.startAt,
        watch: args.watch,
      }),
    });
    return call.finish(created);
  },
  async schedule_update(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    return call.finish(
      await updateScheduleFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        threadId: thread.id,
        ...(thread.groupId ? { scopeThreadId: thread.id } : {}),
        routineId: String(args.routineId ?? ""),
        name: isScheduleValueProvided(args.name) ? String(args.name) : undefined,
        prompt: isScheduleValueProvided(args.prompt) ? String(args.prompt) : undefined,
        active: typeof args.active === "boolean" ? args.active : undefined,
        timezone: isScheduleValueProvided(args.timezone) ? String(args.timezone) : undefined,
        schedule: compactScheduleInput({
          cron: args.cron,
          every: args.every,
          unit: args.unit,
          runAt: args.runAt,
          delayMinutes: args.delayMinutes,
          delaySeconds: args.delaySeconds,
          startAt: args.startAt,
        }),
      }),
    );
  },
  async schedule_list(ctx) {
    const { deps, run, bot, thread } = ctx;
    return listSchedulesFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(thread.groupId ? { threadId: thread.id } : {}),
    });
  },
  async schedule_cancel(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const cancelled = await cancelScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(thread.groupId ? { threadId: thread.id } : {}),
      routineId: args.routineId ? String(args.routineId) : undefined,
      name: args.name ? String(args.name) : undefined,
    });
    return call.finish(cancelled);
  },
  async skill_read(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return skillReadFromTool(
      deps.prisma,
      {
        spaceId: run.spaceId,
        userId: run.userId,
      },
      {
        name: args.name ? String(args.name) : undefined,
        skillId: args.skillId ? String(args.skillId) : undefined,
        file: args.file ? String(args.file) : undefined,
      },
    );
  },
  async skill_create(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillCreateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          description: args.description ? String(args.description) : undefined,
          body: args.body ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async skill_update(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillUpdateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
          newName: args.newName ? String(args.newName) : undefined,
          description: args.description !== undefined ? String(args.description) : undefined,
          body: args.body !== undefined ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async skill_delete(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillDeleteFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
        },
      ),
    );
  },
};
