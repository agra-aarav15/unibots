import { Trans, useLingui } from "@lingui/react/macro";
import { PAYMENT_PAYEE_MAX_LENGTH } from "@unibot/contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@unibot/ui-web";
import { fetchFresh } from "@unibot/core/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** A pending request, formatted for the owner: who is paying, how much, and the reference to match. */
function shownAmount(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

/**
 * Payments the bots asked customers for. Until the owner sets the address money lands in, nothing
 * can be asked for, so the setup form is shown first; once set, only requests awaiting a decision
 * appear. Confirming one wakes the bot that owns the deal.
 */
export function PaymentsPanel() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const payeeQuery = useQuery(queries.payments.payee.queryOptions());
  const pendingOptions = queries.payments.list.queryOptions({ input: { status: "pending" } });
  const pendingQuery = useQuery(pendingOptions);

  const payee = payeeQuery.data?.payeeId ?? null;
  const pending = pendingQuery.data?.requests ?? [];

  const refresh = async () => {
    await Promise.all([
      fetchFresh(queryClient, queries.payments.payee.queryOptions()),
      fetchFresh(queryClient, pendingOptions),
      // Confirming wakes the bot, so the company overview changes too.
      queryClient.invalidateQueries({ queryKey: queries.runs.list.key() }),
    ]);
  };

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  if (payeeQuery.isPending) return null;

  if (!payee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Trans>Where should customers pay?</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            <Trans>Add the UPI ID bots give customers. You confirm each payment before a bot delivers.</Trans>
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = draft.trim();
              if (!value) return;
              void run("payee", () => rpc.payments.setPayee({ payeeId: value }));
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={PAYMENT_PAYEE_MAX_LENGTH}
              placeholder={t`you@bank`}
              aria-label={t`Payment UPI ID`}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={busy !== null || draft.trim().length === 0}>
              <Trans>Save</Trans>
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (pending.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="pending-payments">
      <h2 className="text-[12.5px] font-medium uppercase tracking-wide text-muted-foreground/80">
        <Trans>Payments to confirm</Trans>
      </h2>
      {pending.map((request) => {
        const label = request.customer.trim() || request.botName;
        return (
          <div
            key={request.id}
            className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
          >
            <Badge variant="secondary" className="shrink-0">
              {shownAmount(request.amountMinor, request.currency)}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-[13.5px]">
              {request.description.trim() || label}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-faint-foreground">
              {request.reference}
            </span>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void run(request.id, () => rpc.payments.verify({ id: request.id }))}
            >
              <Trans>Received</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void run(request.id, () => rpc.payments.reject({ id: request.id }))}
            >
              <Trans>Not received</Trans>
            </Button>
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
