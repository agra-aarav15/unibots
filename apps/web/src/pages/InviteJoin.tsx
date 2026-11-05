import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { forgetInvite, pendingInvite, rememberInvite } from "../lib/pending-invite";
import { rpc, selectSpace } from "../lib/rpc";

/**
 * Where a signed-in person lands when they open an invite link. Joining is one request, and the
 * reload after it is what makes the app open in the workspace they just joined — the selection
 * has to be in place before the shell reads it. A link that no longer works says so instead of
 * looping back to sign-in: they are signed in, whatever the link's fate.
 */
export function InviteJoin({ to }: { to: string }) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("invite") ?? pendingInvite();
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!token || refused) return;
    rememberInvite(token);
    let cancelled = false;
    void rpc.spaces
      .acceptInvite({ token })
      .then(({ spaceId }) => {
        forgetInvite();
        selectSpace(spaceId);
        if (!cancelled) window.location.replace(to);
      })
      .catch(() => {
        forgetInvite();
        if (!cancelled) setRefused(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, to, refused]);

  if (!token) return <Navigate to={to} replace />;
  if (!refused) return <PageLoading data-rakazo-app-state="invite-pending" />;
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="space-y-3">
        <p role="alert" className="text-[13.5px] text-muted-foreground">
          <Trans>That invitation is no longer valid.</Trans>
        </p>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => window.location.replace(to)}
        >
          <Trans>Continue</Trans>
        </Button>
      </div>
    </div>
  );
}
