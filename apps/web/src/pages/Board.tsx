import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { Board, Bot, Ticket, TicketPriority, TicketStatus } from "@rakazo/contracts";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TITLE_MAX_LENGTH,
} from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, isRetryableError, retryDelayMs } from "@rakazo/core";
import { fetchFresh, writeSaved } from "@rakazo/core/query";
import {
  BotAvatar,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@rakazo/ui-web";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSpaceQueries } from "../lib/query";
import { formatRelativeTime } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { useTicketPriorityLabels } from "../lib/ticket-priority";
import { useTicketStatusLabels } from "../lib/ticket-status";
import { errorText } from "../lib/user-error";
import { WindowChrome } from "./WindowChrome";

/** Priorities worth a mark on the card; normal is what a ticket means unless it says otherwise. */
const MARKED_PRIORITIES: Partial<Record<TicketPriority, string>> = {
  urgent: "text-destructive",
  high: "text-warning",
  low: "text-muted-foreground",
};

export function BoardPage() {
  const { t } = useLingui();
  const statuses = useTicketStatusLabels();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const boardsQuery = useQuery(queries.boards.list.queryOptions());
  const boards = boardsQuery.data ?? [];
  const [chosenBoardId, setChosenBoardId] = useState<string | null>(null);
  // The first board is the workspace's default, which is what older screens mean by "the board".
  const board = boards.find((candidate) => candidate.id === chosenBoardId) ?? boards[0];
  const ticketsOptions = queries.tickets.list.queryOptions({
    input: board ? { boardId: board.id } : {},
  });
  const ticketsQuery = useQuery(ticketsOptions);
  const botsQuery = useQuery(queries.bots.list.queryOptions());
  const tickets = ticketsQuery.data?.tickets ?? [];
  const bots = botsQuery.data ?? [];
  const [selected, setSelected] = useState<Ticket | "new" | null>(null);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [streamError, setError] = useState("");
  const loadFailed = ticketsQuery.error ?? botsQuery.error ?? boardsQuery.error;
  const error = streamError || (loadFailed ? errorText(loadFailed) : "");
  /** A read sent after a change, so an older one in flight cannot bring back the old board. */
  const reload = () => fetchFresh(queryClient, ticketsOptions).then(() => undefined);
  // The live stream covers the whole workspace and stays open across board switches, so it
  // refreshes whichever board is on screen rather than closing and reopening per board.
  const ticketsOptionsRef = useRef(ticketsOptions);
  ticketsOptionsRef.current = ticketsOptions;

  useEffect(() => {
    let currentController: AbortController | undefined;
    let active = true;
    // Live events refresh the board and any open ticket's comments.
    const refreshComments = (ticketId?: string) =>
      void queryClient.invalidateQueries({
        queryKey: ticketId
          ? queries.tickets.comments.queryKey({ input: { ticketId } })
          : queries.tickets.comments.key(),
      });
    let cancelRetry: (() => void) | undefined;
    void (async () => {
      while (active) {
        const controller = new AbortController();
        currentController = controller;
        let failure: unknown;
        try {
          const stream = await rpc.boards.subscribe(undefined, {
            signal: controller.signal,
          });
          if (!active) return;
          await fetchFresh(queryClient, ticketsOptionsRef.current);
          if (!active) return;
          refreshComments();
          setError("");
          for await (const event of stream) {
            if (!active) return;
            refreshComments(event.ticketId);
            await fetchFresh(queryClient, ticketsOptionsRef.current);
          }
        } catch (cause) {
          failure = cause;
          if (active) setError(errorText(cause));
        } finally {
          controller.abort();
        }
        if (!active || !isRetryableError(failure)) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryDelayMs(failure, 1_000));
          cancelRetry = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        cancelRetry = undefined;
      }
    })();
    return () => {
      active = false;
      currentController?.abort();
      cancelRetry?.();
    };
  }, [queries]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <WindowChrome />
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Link
          to="/app"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={t`Back`}
        >
          <ChevronLeft />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate font-medium">{board?.name ?? t`Board`}</h1>
          <NativeSelect
            aria-label={t`Board`}
            className="h-8 w-auto"
            value={board?.id ?? ""}
            onChange={(event) => setChosenBoardId(event.target.value)}
          >
            {boards.map((candidate) => (
              <NativeSelectOption key={candidate.id} value={candidate.id}>
                {candidate.name} · {candidate.ticketPrefix}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button variant="ghost" onClick={() => setCreatingBoard(true)}>
          <Trans>New board</Trans>
        </Button>
        <Button onClick={() => setSelected("new")} disabled={bots.length === 0 || !board}>
          <Trans>New ticket</Trans>
        </Button>
      </header>
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <main className="relative min-h-0 min-w-0 flex-1 overflow-auto">
        <div data-testid="board-columns" className="flex min-h-full gap-4 p-4">
          {TICKET_STATUSES.map((status) => {
            const columnTickets = tickets.filter((ticket) => ticket.status === status);
            return (
              <section key={status} className="flex min-w-44 flex-1 flex-col gap-2">
                <div className="flex items-baseline gap-2 px-1">
                  <h2 className="text-sm font-medium">{statuses[status]}</h2>
                  <span aria-hidden="true" className="text-xs tabular-nums text-faint-foreground">
                    {columnTickets.length}
                  </span>
                </div>
                {columnTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    bot={bots.find((candidate) => candidate.id === ticket.assigneeBotId)}
                    onOpen={() => setSelected(ticket)}
                  />
                ))}
              </section>
            );
          })}
        </div>
        {tickets.length === 0 && !error ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            <Trans>No tickets yet</Trans>
          </p>
        ) : null}
      </main>
      {selected ? (
        <TicketDialog
          key={selected === "new" ? "new" : selected.id}
          ticket={selected === "new" ? null : selected}
          bots={bots}
          boardId={board?.id}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      ) : null}
      {creatingBoard ? (
        <NewBoardDialog
          onClose={() => setCreatingBoard(false)}
          onCreated={async (created) => {
            setCreatingBoard(false);
            setChosenBoardId(created.id);
            await fetchFresh(queryClient, queries.boards.list.queryOptions());
          }}
        />
      ) : null}
    </div>
  );
}

function TicketCard({
  ticket,
  bot,
  onOpen,
}: {
  ticket: Ticket;
  bot: Bot | undefined;
  onOpen: () => void;
}) {
  const priorities = useTicketPriorityLabels();
  const priorityTone = MARKED_PRIORITIES[ticket.priority];
  const working = bot ? ACTIVE_RUN_STATUSES.some((status) => status === bot.status) : false;
  return (
    <Button
      data-testid={`board-card-${ticket.id}`}
      variant="outline"
      className="h-auto w-full flex-col items-stretch gap-2 whitespace-normal rounded-xl p-3 text-left font-normal"
      onClick={onOpen}
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-faint-foreground">{ticket.ref}</span>
        {priorityTone ? (
          <span className={`text-[11px] font-medium ${priorityTone}`}>
            {priorities[ticket.priority]}
          </span>
        ) : null}
      </span>
      <span className="line-clamp-3 text-[13.5px] leading-snug">{ticket.title}</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {bot ? (
          <>
            <BotAvatar
              color={bot.color}
              avatarSet={bot.avatarSet}
              identity={bot.id}
              status={bot.status}
              size={18}
            />
            <span className="truncate">{bot.name}</span>
            {working ? (
              <span aria-hidden="true" className="ms-auto size-1.5 rounded-full bg-status-working" />
            ) : null}
          </>
        ) : (
          <Trans>Unassigned</Trans>
        )}
      </span>
    </Button>
  );
}

function TicketDialog({
  ticket,
  bots,
  boardId,
  onClose,
  onSaved,
}: {
  ticket: Ticket | null;
  bots: Bot[];
  boardId?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLingui();
  const formId = useId();
  const statuses = useTicketStatusLabels();
  const priorities = useTicketPriorityLabels();
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [owner, setOwner] = useState(ticket?.assigneeBotId ?? bots[0]?.id ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket?.status ?? "todo");
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? "normal");
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const commentsOptions = queries.tickets.comments.queryOptions({
    input: ticket ? { ticketId: ticket.id, boardId } : skipToken,
  });
  const commentsQuery = useQuery(commentsOptions);
  const comments = commentsQuery.data ?? [];
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shownError = error || (commentsQuery.error ? errorText(commentsQuery.error) : "");

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (ticket)
        await rpc.tickets.update({
          id: ticket.id,
          ...(boardId ? { boardId } : {}),
          ...(title !== ticket.title ? { title } : {}),
          ...(description !== (ticket.description ?? "") ? { description } : {}),
          ...(owner !== (ticket.assigneeBotId ?? bots[0]?.id ?? "")
            ? { assigneeBotId: owner }
            : {}),
          ...(status !== ticket.status ? { status } : {}),
          ...(priority !== ticket.priority ? { priority } : {}),
        });
      else
        await rpc.tickets.create({
          ...(boardId ? { boardId } : {}),
          title,
          description,
          assigneeBotId: owner,
          priority,
        });
      await onSaved();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function comment() {
    if (!ticket) return;
    setBusy(true);
    setError("");
    try {
      const row = await rpc.tickets.comment({
        ticketId: ticket.id,
        ...(boardId ? { boardId } : {}),
        body,
      });
      const options = queries.tickets.comments.queryOptions({
        input: { ticketId: ticket.id, boardId },
      });
      // A list already on screen shows the comment at once, unless a read already brought it.
      if (queryClient.getQueryData(options.queryKey)) {
        await writeSaved(queryClient, options.queryKey, (previous = []) =>
          previous.some((item) => item.id === row.id) ? previous : [...previous, row],
        );
      }
      setBody("");
      // Saving cancelled any read in flight, so the whole list is read again after the post.
      void fetchFresh(queryClient, options).catch(() => undefined);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket?.title ?? t`New ticket`}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`${formId}-title`} className="block space-y-1 text-sm">
            <span>
              <Trans>Title</Trans>
            </span>
            <Input
              id={`${formId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={TICKET_TITLE_MAX_LENGTH}
              required
            />
          </label>
          <label htmlFor={`${formId}-description`} className="block space-y-1 text-sm">
            <span>
              <Trans>Description</Trans>
            </span>
            <Textarea
              id={`${formId}-description`}
              data-testid="ticket-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={TICKET_DESCRIPTION_MAX_LENGTH}
            />
          </label>
          <label htmlFor={`${formId}-owner`} className="block space-y-1 text-sm">
            <span>
              <Trans>Owner</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-owner`}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              required
            >
              {bots.map((bot) => (
                <NativeSelectOption key={bot.id} value={bot.id}>
                  {bot.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {ticket ? (
            <label htmlFor={`${formId}-status`} className="block space-y-1 text-sm">
              <span>
                <Trans>Status</Trans>
              </span>
              <NativeSelect
                className="w-full"
                id={`${formId}-status`}
                value={status}
                onChange={(event) => setStatus(event.target.value as TicketStatus)}
              >
                {TICKET_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {statuses[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <label htmlFor={`${formId}-priority`} className="block space-y-1 text-sm">
            <span>
              <Trans>Priority</Trans>
            </span>
            <NativeSelect
              className="w-full"
              id={`${formId}-priority`}
              value={priority}
              onChange={(event) => setPriority(event.target.value as TicketPriority)}
            >
              {TICKET_PRIORITIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {priorities[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !title.trim() || !owner}>
              {ticket ? t`Save` : t`Create`}
            </Button>
          </div>
        </form>
        {ticket ? (
          <div data-testid="ticket-comments" className="space-y-3 border-t pt-3">
            {comments.map((row) => (
              <div key={row.id} className="text-sm">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{row.authorName}</span>
                  <time dateTime={row.createdAt}>{formatRelativeTime(row.createdAt)}</time>
                </div>
                <ChatMarkdown>{row.body}</ChatMarkdown>
              </div>
            ))}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void comment();
              }}
            >
              <Textarea
                aria-label={t`Comment`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={TICKET_COMMENT_MAX_LENGTH}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={busy || !body.trim()}>
                  <Trans>Comment</Trans>
                </Button>
              </div>
            </form>
          </div>
        ) : null}
        {shownError ? (
          <p role="alert" className="text-sm text-destructive">
            {shownError}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A named board with a prefix of its own, so its tickets read `MKT-4` rather than a bare number. */
function NewBoardDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (board: Board) => Promise<void>;
}) {
  const { t } = useLingui();
  const formId = useId();
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const board = await rpc.boards.create({
        name: name.trim(),
        ticketPrefix: prefix.trim().toUpperCase(),
      });
      await onCreated(board);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>New board</Trans>
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor={`${formId}-name`} className="block space-y-1 text-sm">
            <span>
              <Trans>Name</Trans>
            </span>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t`Marketing`}
              required
            />
          </label>
          <label htmlFor={`${formId}-prefix`} className="block space-y-1 text-sm">
            <span>
              <Trans>Ticket prefix</Trans>
            </span>
            <Input
              id={`${formId}-prefix`}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value.toUpperCase())}
              placeholder={t`MKT`}
              pattern="[A-Za-z][A-Za-z0-9]*"
              maxLength={12}
              required
            />
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !name.trim() || !prefix.trim()}>
              <Trans>Create</Trans>
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}