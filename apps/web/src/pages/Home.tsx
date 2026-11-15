import { Trans } from "@lingui/react/macro";
import type { RunActivityRow, SpaceBot, TicketStatus } from "@unibot/contracts";
import { TICKET_STATUSES } from "@unibot/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@unibot/ui-web";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PaymentsPanel } from "../components/PaymentsPanel";
import { activityPreview } from "../lib/activity-list-filters";
import { blockedTickets, summarizeBoard, splitRuns, type BoardSummary } from "../lib/company-overview";
import { useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { useTicketStatusLabels } from "../lib/ticket-status";
import { statusLabel, statusTone } from "./ActivityList";
import { TicketCard } from "./Board";

/**
 * The company at a glance: what needs the owner, what the bots are doing on their own, and the
 * boards' shape. It reads the same rpc queries the board and activity list use, so it never shows
 * a second kind of truth.
 */
export function HomePage() {
  const queries = useSpaceQueries();
  const navigate = useNavigate();
  const statuses = useTicketStatusLabels();

  const runsQuery = useQuery(queries.runs.list.queryOptions({ input: { filter: "active" } }));
  const boardsQuery = useQuery(queries.boards.list.queryOptions());
  const botsQuery = useQuery(queries.boards.assignees.queryOptions());

  const boards = boardsQuery.data ?? [];
  const bots = botsQuery.data ?? [];
  const runs = runsQuery.data?.runs ?? [];

  const ticketQueries = useQueries({
    queries: boards.map((board) =>
      queries.tickets.list.queryOptions({ input: { boardId: board.id } }),
    ),
  });
  const summaries = boards.map((board, index) =>
    summarizeBoard(board, ticketQueries[index]?.data?.tickets ?? []),
  );

  const { needsYou, working } = splitRuns(runs);
  const blocked = blockedTickets(summaries);
  const failure = runsQuery.error ?? boardsQuery.error ?? botsQuery.error;

  const openRun = (run: RunActivityRow) =>
    navigate(run.groupId ? `/app/g/${run.groupId}` : `/app/${run.botId}`);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-semibold">
            <Trans>Company</Trans>
          </h1>
          <Button variant="outline" size="sm" onClick={() => navigate("/app/board")}>
            <Trans>Open board</Trans>
          </Button>
        </header>

        {failure ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not load the company overview.</Trans>
          </p>
        ) : null}

        <PaymentsPanel />

        {needsYou.length > 0 || blocked.length > 0 ? (
          <Section title={<Trans>Needs you</Trans>}>
            {needsYou.map((run) => (
              <RunRow key={run.runId} run={run} onOpen={() => openRun(run)} />
            ))}
            {blocked.map(({ boardId, ticket }) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => navigate(`/app/board?board=${boardId}`)}
                className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:bg-accent"
              >
                <Badge variant="destructive" className="shrink-0">
                  <Trans>Blocked</Trans>
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{ticket.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint-foreground">
                  {ticket.ref}
                </span>
              </button>
            ))}
          </Section>
        ) : null}

        {working.length > 0 ? (
          <Section title={<Trans>Working now</Trans>}>
            {working.map((run) => (
              <RunRow key={run.runId} run={run} onOpen={() => openRun(run)} />
            ))}
          </Section>
        ) : null}

        <Section title={<Trans>Boards</Trans>}>
          {summaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No boards yet.</Trans>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {summaries.map((summary) => (
                <BoardCard
                  key={summary.board.id}
                  summary={summary}
                  bots={bots}
                  statuses={statuses}
                  onOpen={() => navigate(`/app/board?board=${summary.board.id}`)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[12.5px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RunRow({ run, onOpen }: { run: RunActivityRow; onOpen: () => void }) {
  const tone = statusTone(run.status, run.updatedAt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left hover:bg-accent"
    >
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full bg-current ${tone}`} />
      <span className="shrink-0 text-[13.5px] font-medium">{run.botName}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
        {activityPreview(run)}
      </span>
      <span className={`shrink-0 text-xs ${tone}`}>{statusLabel(run.status)}</span>
      <span className="shrink-0 text-xs text-muted-foreground/80">
        {formatRelativeTime(run.updatedAt)}
      </span>
    </button>
  );
}

function BoardCard({
  summary,
  bots,
  statuses,
  onOpen,
}: {
  summary: BoardSummary;
  bots: SpaceBot[];
  statuses: Record<TicketStatus, string>;
  onOpen: () => void;
}) {
  const { board, counts, open } = summary;
  const marked = TICKET_STATUSES.filter((status) => counts[status] > 0);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">{board.name}</CardTitle>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          <Trans>Open</Trans>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {marked.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            <Trans>No tickets yet.</Trans>
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {marked.map((status) => (
              <Badge key={status} variant={status === "blocked" ? "destructive" : "secondary"}>
                <span>
                  {statuses[status]} · {counts[status]}
                </span>
              </Badge>
            ))}
          </div>
        )}
        {open.slice(0, 3).map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            bot={bots.find((candidate) => candidate.id === ticket.assigneeBotId)}
            onOpen={onOpen}
          />
        ))}
      </CardContent>
    </Card>
  );
}