import { beforeEach, describe, expect, it, vi } from "vitest";
import { sweepTicketWork } from "./ticket-sweep.js";
import { wakeTicketAssignee } from "./ticket-wake.js";

vi.mock("./ticket-wake.js", () => ({ wakeTicketAssignee: vi.fn() }));

beforeEach(() => {
  vi.mocked(wakeTicketAssignee).mockReset();
});

function deps(tickets: { id: string; spaceId: string; assigneeBotId: string }[], failed = 0) {
  const findMany = vi.fn(async () => tickets);
  const count = vi.fn(async () => failed);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const create = vi.fn(async () => ({}));
  const transaction = vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
    fn({ ticket: { updateMany }, ticketComment: { create } }),
  );
  const enqueue = vi.fn(async () => undefined);
  return {
    findMany,
    count,
    updateMany,
    create,
    prisma: {
      ticket: { findMany },
      run: { count },
      $transaction: transaction,
    } as never,
    jobs: { enqueue } as never,
  };
}

describe("sweepTicketWork", () => {
  it("does nothing when the board is off", async () => {
    const d = deps([]);
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: false }),
    ).resolves.toBe(0);
    expect(d.findMany).not.toHaveBeenCalled();
    expect(wakeTicketAssignee).not.toHaveBeenCalled();
  });

  it("asks for open, assigned tickets that nobody is working", async () => {
    const d = deps([]);
    await sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true });
    expect(d.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["todo", "doing"] },
          assigneeBotId: { not: null },
          // One ticket, one run: anything with a live run is left alone.
          runs: { none: { status: { in: expect.arrayContaining(["running"]) } } },
        }),
      }),
    );
  });

  it("wakes each ticket's owner and counts the runs it started", async () => {
    const d = deps([
      { id: "t1", spaceId: "s1", assigneeBotId: "b1" },
      { id: "t2", spaceId: "s1", assigneeBotId: "b2" },
    ]);
    vi.mocked(wakeTicketAssignee).mockResolvedValue("run-1");
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true }),
    ).resolves.toBe(2);
    expect(wakeTicketAssignee).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { spaceId: "s1", ticketId: "t1", botId: "b1" },
    );
    expect(wakeTicketAssignee).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { spaceId: "s1", ticketId: "t2", botId: "b2" },
    );
  });

  it("does not count a ticket whose owner is already working it", async () => {
    const d = deps([{ id: "t1", spaceId: "s1", assigneeBotId: "b1" }]);
    // The wake declines because an active run already exists.
    vi.mocked(wakeTicketAssignee).mockResolvedValue(null);
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true }),
    ).resolves.toBe(0);
  });

  it("keeps going when one ticket fails", async () => {
    const d = deps([
      { id: "t1", spaceId: "s1", assigneeBotId: "b1" },
      { id: "t2", spaceId: "s1", assigneeBotId: "b2" },
    ]);
    vi.mocked(wakeTicketAssignee)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("run-2");
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true }),
    ).resolves.toBe(1);
  });

  it("takes a bounded batch so one pass cannot flood the queue", async () => {
    const d = deps([]);
    await sweepTicketWork(
      { prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true },
      { limit: 5 },
    );
    expect(d.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });

  it("blocks a ticket instead of retrying it forever", async () => {
    const d = deps([{ id: "t1", spaceId: "s1", assigneeBotId: "b1" }], 2);
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true }),
    ).resolves.toBe(0);
    // No third run, and the ticket is taken out of play with one comment saying so.
    expect(wakeTicketAssignee).not.toHaveBeenCalled();
    expect(d.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", spaceId: "s1", status: { in: ["todo", "doing"] } },
      data: { status: "blocked" },
    });
    expect(d.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: "t1", authorBotId: null }),
      }),
    );
  });

  it("still wakes a ticket that has only failed once", async () => {
    const d = deps([{ id: "t1", spaceId: "s1", assigneeBotId: "b1" }], 1);
    vi.mocked(wakeTicketAssignee).mockResolvedValue("run-1");
    await expect(
      sweepTicketWork({ prisma: d.prisma, jobs: d.jobs, ticketBoardEnabled: true }),
    ).resolves.toBe(1);
    expect(d.updateMany).not.toHaveBeenCalled();
  });
});