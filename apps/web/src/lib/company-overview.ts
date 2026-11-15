import type { Board, RunActivityRow, Ticket, TicketStatus } from "@unibot/contracts";
import { TICKET_STATUSES, isTicketCompletedStatus } from "@unibot/contracts";

/**
 * The home screen's view model. It is deliberately plain: the page renders whatever this returns,
 * so the "who is working / what needs me" rules are testable without a browser or a server.
 */

/** A run in these states has stopped and is waiting for the owner to decide or take over. */
const NEEDS_OWNER: ReadonlySet<RunActivityRow["status"]> = new Set([
  "waiting_input",
  "waiting_takeover",
]);

/** A run that keeps going without the owner. */
const IN_FLIGHT: ReadonlySet<RunActivityRow["status"]> = new Set(["queued", "leased", "running"]);

export type RunSplit = {
  /** The owner's turn: the company is blocked until they answer or take over. */
  needsYou: RunActivityRow[];
  /** Still progressing on its own. */
  working: RunActivityRow[];
};

/** Splits the workspace's live runs into "your turn" and "still going". */
export function splitRuns(runs: readonly RunActivityRow[]): RunSplit {
  const needsYou: RunActivityRow[] = [];
  const working: RunActivityRow[] = [];
  for (const run of runs) {
    if (NEEDS_OWNER.has(run.status)) needsYou.push(run);
    else if (IN_FLIGHT.has(run.status)) working.push(run);
  }
  return { needsYou, working };
}

export type BoardSummary = {
  board: Board;
  /** Every ticket on the board by status, so the page can show the shape of the work. */
  counts: Record<TicketStatus, number>;
  /** Tickets the board is still carrying, in the same order as the board's columns. */
  open: Ticket[];
};

function columnOrder(status: TicketStatus): number {
  return TICKET_STATUSES.indexOf(status);
}

/** One board's counts plus its open tickets, in column order. */
export function summarizeBoard(board: Board, tickets: readonly Ticket[]): BoardSummary {
  const counts = Object.fromEntries(
    TICKET_STATUSES.map((status) => [status, 0]),
  ) as Record<TicketStatus, number>;
  const open: Ticket[] = [];
  for (const ticket of tickets) {
    counts[ticket.status] += 1;
    if (!isTicketCompletedStatus(ticket.status)) open.push(ticket);
  }
  open.sort((left, right) => columnOrder(left.status) - columnOrder(right.status));
  return { board, counts, open };
}

/** Blocked tickets across boards: the clearest "a person needs to act" signal on the board. */
export function blockedTickets(
  summaries: readonly BoardSummary[],
): Array<{ boardId: string; ticket: Ticket }> {
  return summaries.flatMap((summary) =>
    summary.open
      .filter((ticket) => ticket.status === "blocked")
      .map((ticket) => ({ boardId: summary.board.id, ticket })),
  );
}