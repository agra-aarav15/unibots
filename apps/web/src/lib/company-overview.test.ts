import type { Board, RunActivityRow, Ticket, TicketStatus } from "@unibot/contracts";
import { describe, expect, it } from "vitest";
import { blockedTickets, splitRuns, summarizeBoard } from "./company-overview";

const BOARD: Board = {
  id: "board-1",
  spaceId: "space-1",
  name: "Sales",
  ticketPrefix: "SAL",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function ticket(id: string, status: TicketStatus, number: number): Ticket {
  return {
    id,
    boardId: BOARD.id,
    spaceId: BOARD.spaceId,
    number,
    ref: `SAL-${number}`,
    title: `Ticket ${id}`,
    description: null,
    status,
    priority: "normal",
    assigneeBotId: null,
    createdByBotId: null,
    createdByUserId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
  };
}

function run(runId: string, status: RunActivityRow["status"]): RunActivityRow {
  return {
    runId,
    botId: "bot-1",
    botName: "Scout",
    groupId: null,
    groupName: null,
    threadId: "thread-1",
    status,
    trigger: "tickets",
    notificationsEnabled: true,
    promptSnippet: "Find leads",
    agentMessage: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("splitRuns", () => {
  it("puts runs waiting on the owner in needsYou and in-flight runs in working", () => {
    const split = splitRuns([
      run("a", "waiting_input"),
      run("b", "waiting_takeover"),
      run("c", "running"),
      run("d", "queued"),
      run("e", "leased"),
    ]);
    expect(split.needsYou.map((item) => item.runId)).toEqual(["a", "b"]);
    expect(split.working.map((item) => item.runId)).toEqual(["c", "d", "e"]);
  });

  it("drops finished, failed and cancelled runs", () => {
    const split = splitRuns([run("a", "completed"), run("b", "failed"), run("c", "cancelled")]);
    expect(split.needsYou).toEqual([]);
    expect(split.working).toEqual([]);
  });
});

describe("summarizeBoard", () => {
  it("counts every status and keeps only open tickets in column order", () => {
    const summary = summarizeBoard(BOARD, [
      ticket("done", "done", 1),
      ticket("blocked", "blocked", 2),
      ticket("todo", "todo", 3),
      ticket("doing", "doing", 4),
      ticket("closed", "closed", 5),
      ticket("review", "review", 6),
    ]);
    expect(summary.counts).toEqual({
      todo: 1,
      doing: 1,
      review: 1,
      blocked: 1,
      done: 1,
      closed: 1,
    });
    expect(summary.open.map((item) => item.id)).toEqual(["todo", "doing", "review", "blocked"]);
  });

  it("returns zero counts for a board with no tickets", () => {
    const summary = summarizeBoard(BOARD, []);
    expect(summary.counts).toEqual({ todo: 0, doing: 0, review: 0, blocked: 0, done: 0, closed: 0 });
    expect(summary.open).toEqual([]);
  });
});

describe("blockedTickets", () => {
  it("collects blocked tickets across boards with their board id", () => {
    const other: Board = { ...BOARD, id: "board-2", ticketPrefix: "OPS" };
    const summaries = [
      summarizeBoard(BOARD, [ticket("blocked", "blocked", 2), ticket("todo", "todo", 3)]),
      summarizeBoard(other, [ticket("also-blocked", "blocked", 9)]),
    ];
    expect(blockedTickets(summaries)).toEqual([
      { boardId: "board-1", ticket: expect.objectContaining({ id: "blocked" }) },
      { boardId: "board-2", ticket: expect.objectContaining({ id: "also-blocked" }) },
    ]);
  });
});