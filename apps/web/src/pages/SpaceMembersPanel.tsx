import { Trans, useLingui } from "@lingui/react/macro";
import type { SpaceInvitation, SpaceMember } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useCopyText } from "../lib/copy-text";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";

/**
 * Who is in this workspace and how to let someone else in. Any member sees the roster; only
 * owners mint links, change roles, or remove someone.
 */
export function SpaceMembersPanel({ spaceId }: { spaceId: string }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const members = useQuery(queries.spaces.members.queryOptions({ input: { spaceId } }));
  const self = members.data?.find((member) => member.isSelf);
  const isOwner = self?.role === "owner";
  const invitations = useQuery({
    ...queries.spaces.invitations.queryOptions({ input: { spaceId } }),
    enabled: isOwner,
  });
  const [inviting, setInviting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queries.spaces.members.key() });
    void queryClient.invalidateQueries({ queryKey: queries.spaces.invitations.key() });
  }

  const setRole = useMutation({
    mutationFn: (input: { memberUserId: string; role: SpaceMember["role"] }) =>
      rpc.spaces.setMemberRole({ spaceId, ...input }),
    onSuccess: refresh,
    onError: (error) => setActionError(errorText(error)),
  });
  const removeMember = useMutation({
    mutationFn: (memberUserId: string) => rpc.spaces.removeMember({ spaceId, memberUserId }),
    onSuccess: refresh,
    onError: (error) => setActionError(errorText(error)),
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) => rpc.spaces.revokeInvitation({ spaceId, invitationId }),
    onSuccess: refresh,
    onError: (error) => setActionError(errorText(error)),
  });

  if (members.isLoading) return null;
  if (members.isError) {
    return (
      <div role="alert" className="text-[12.5px] text-destructive">
        {errorText(members.error)}
        <Button variant="ghost" size="sm" onClick={() => void members.refetch()}>
          {t`Retry`}
        </Button>
      </div>
    );
  }

  const pending = invitations.data ?? [];

  return (
    <div className="space-y-3" data-testid="space-members">
      <SettingsGroup>
        {(members.data ?? []).map((member) => (
          <SettingsRow
            key={member.userId}
            label={
              <>
                <p>{member.name || member.email}</p>
                <p className="text-[13px] text-muted-foreground">
                  {member.role === "owner" ? t`Owner` : t`Member`}
                </p>
              </>
            }
            control={
              isOwner && !member.isSelf ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    disabled={setRole.isPending || removeMember.isPending}
                    onClick={() =>
                      setRole.mutate({
                        memberUserId: member.userId,
                        role: member.role === "owner" ? "member" : "owner",
                      })
                    }
                  >
                    {member.role === "owner" ? t`Make member` : t`Make owner`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-destructive"
                    disabled={setRole.isPending || removeMember.isPending}
                    onClick={() => removeMember.mutate(member.userId)}
                  >
                    <Trans>Remove</Trans>
                  </Button>
                </div>
              ) : null
            }
          />
        ))}
        {isOwner ? (
          <SettingsRow
            label={<p>{t`Invite someone`}</p>}
            control={
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setInviting(true)}
              >
                <Trans>Create a link</Trans>
              </Button>
            }
          />
        ) : null}
      </SettingsGroup>
      {pending.length > 0 ? (
        <SettingsGroup>
          {pending.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={
                <p className="text-muted-foreground">
                  {invitation.email ?? t`Anyone with the link`}
                </p>
              }
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invitation.id)}
                >
                  <Trans>Revoke</Trans>
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {actionError}
        </p>
      ) : null}
      {inviting ? (
        <InviteMemberDialog
          spaceId={spaceId}
          onClose={() => setInviting(false)}
          onCreated={refresh}
        />
      ) : null}
    </div>
  );
}

/** Builds one link, then shows it. The email is optional and, when given, binds the link to it. */
function InviteMemberDialog({
  spaceId,
  onClose,
  onCreated,
}: {
  spaceId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [copied, copy] = useCopyText();
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<SpaceInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      rpc.spaces.invite({
        spaceId,
        ...(email.trim() ? { email: email.trim() } : {}),
      }),
    onSuccess: (invitation) => {
      setCreated(invitation);
      onCreated();
    },
    onError: (err) => setError(errorText(err)),
  });

  const link = created ? `${window.location.origin}/sign-up?invite=${created.token}` : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Invite to this workspace</Trans>
          </DialogTitle>
          {created ? null : (
            <DialogDescription>
              <Trans>They join this workspace when they open the link.</Trans>
            </DialogDescription>
          )}
        </DialogHeader>
        {link ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              aria-label={t`Invite link`}
              value={link}
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button variant="outline" onClick={() => copy(link)}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
            </Button>
          </div>
        ) : (
          <>
            <Input
              aria-label={t`Email (optional)`}
              placeholder={t`Email (optional)`}
              type="email"
              value={email}
              disabled={create.isPending}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={create.isPending} onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button disabled={create.isPending} onClick={() => create.mutate()}>
                <Trans>Create link</Trans>
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-[12.5px] text-destructive">
                {error}
              </p>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
