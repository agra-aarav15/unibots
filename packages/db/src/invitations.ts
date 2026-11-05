import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { IsolationError } from "./scope.js";
import { SpaceDeletionInProgressError } from "./spaces.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** A link that still works after a week is a link that has had time to leak. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITATION_PENDING = "pending";
export const INVITATION_ACCEPTED = "accepted";
export const INVITATION_REVOKED = "revoked";

export type SpaceMemberRole = "owner" | "member";

export class InvitationNotFoundError extends Error {
  constructor(message = "That invitation link is no longer valid") {
    super(message);
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationEmailMismatchError extends Error {
  constructor() {
    super("That invitation was sent to a different email address");
    this.name = "InvitationEmailMismatchError";
  }
}

export class NotSpaceOwnerError extends Error {
  constructor() {
    super("Only the workspace owner can do that");
    this.name = "NotSpaceOwnerError";
  }
}

export class AlreadySpaceMemberError extends Error {
  constructor() {
    super("They are already in this workspace");
    this.name = "AlreadySpaceMemberError";
  }
}

export class CannotRemoveLastOwnerError extends Error {
  constructor() {
    super("A workspace needs at least one owner");
    this.name = "CannotRemoveLastOwnerError";
  }
}

export class NotSpaceMemberError extends Error {
  constructor() {
    super("They are not in this workspace");
    this.name = "NotSpaceMemberError";
  }
}

export interface SpaceInvitationView {
  id: string;
  email: string | null;
  role: string;
  token: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SpaceMemberView {
  userId: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
  /** True for the member reading the list, so the interface does not offer to remove itself. */
  isSelf: boolean;
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  token: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

type InvitationRow = {
  id: string;
  email: string | null;
  role: string | null;
  token: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

function toInvitationView(row: InvitationRow): SpaceInvitationView {
  return { ...row, role: row.role ?? "member", token: row.token ?? "" };
}

/** An address is a label unless it is there to be matched exactly. */
function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function newRole(role: string | undefined): SpaceMemberRole {
  return role === "owner" ? "owner" : "member";
}

/**
 * Owners only, checked inside the transaction: every invitation query below runs with it.
 * Returns the organization the space belongs to, so the caller does not have to look it up.
 */
async function requireOwnedSpace(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; userId: string },
): Promise<{ organizationId: string }> {
  const membership = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    select: {
      organizationId: true,
      role: true,
      space: { select: { deletingAt: true } },
    },
  });
  if (!membership) throw new IsolationError();
  if (membership.role !== "owner") throw new NotSpaceOwnerError();
  if (membership.space.deletingAt) throw new SpaceDeletionInProgressError();
  return { organizationId: membership.organizationId };
}

/**
 * Mints a link into a workspace. Any earlier pending link for the same address (or the same
 * open link, when no address is given) stops working, so there is never more than one way in
 * per invitee to revoke.
 */
export async function createSpaceInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; invitedByUserId: string; email?: string | null; role?: string },
): Promise<SpaceInvitationView> {
  const email = normalizeEmail(input.email);
  const role = newRole(input.role);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const { organizationId } = await requireOwnedSpace(tx, {
          spaceId: input.spaceId,
          userId: input.invitedByUserId,
        });
        if (email) {
          const invitee = await tx.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true },
          });
          if (invitee) {
            const existing = await tx.spaceMember.findUnique({
              where: { spaceId_userId: { spaceId: input.spaceId, userId: invitee.id } },
              select: { id: true },
            });
            if (existing) throw new AlreadySpaceMemberError();
          }
        }
        await tx.invitation.updateMany({
          where: { spaceId: input.spaceId, status: INVITATION_PENDING, email },
          data: { status: INVITATION_REVOKED },
        });
        const created = await tx.invitation.create({
          data: {
            id: randomUUID(),
            organizationId,
            spaceId: input.spaceId,
            email,
            role,
            status: INVITATION_PENDING,
            token,
            expiresAt,
            inviterId: input.invitedByUserId,
          },
          select: invitationSelect,
        });
        return toInvitationView(created);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/** Pending links only: an accepted one has served its purpose and a revoked one is gone. */
export async function listSpaceInvitations(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<SpaceInvitationView[]> {
  const rows = await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await requireOwnedSpace(tx, input);
      return tx.invitation.findMany({
        where: {
          spaceId: input.spaceId,
          status: INVITATION_PENDING,
          expiresAt: { gt: new Date() },
        },
        select: invitationSelect,
        orderBy: { createdAt: "desc" },
      });
    }),
  );
  return rows.map(toInvitationView);
}

export async function revokeSpaceInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string; invitationId: string },
): Promise<void> {
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await requireOwnedSpace(tx, input);
      await tx.invitation.updateMany({
        where: {
          id: input.invitationId,
          spaceId: input.spaceId,
          status: INVITATION_PENDING,
        },
        data: { status: INVITATION_REVOKED },
      });
    }),
  );
}

/**
 * Turns a link into a membership. Runs as the person joining, so the only thing it can add is
 * their own seat: the invitation names the workspace, the caller does not.
 */
export async function acceptSpaceInvitation(
  prisma: PrismaClient,
  input: { token: string; userId: string; email: string },
): Promise<{ spaceId: string; name: string }> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const invitation = await tx.invitation.findUnique({
          where: { token: input.token },
          select: {
            id: true,
            spaceId: true,
            organizationId: true,
            email: true,
            role: true,
            status: true,
            expiresAt: true,
            space: { select: { name: true } },
          },
        });
        const usable =
          invitation?.spaceId &&
          invitation.status === INVITATION_PENDING &&
          invitation.expiresAt > new Date() &&
          Boolean(invitation.space);
        if (!invitation || !usable) throw new InvitationNotFoundError();
        if (
          invitation.email &&
          invitation.email.toLowerCase() !== input.email.trim().toLowerCase()
        ) {
          throw new InvitationEmailMismatchError();
        }
        const role = newRole(invitation.role ?? undefined);
        // The organization membership comes first: a SpaceMember row points at it.
        await tx.member
          .create({
            data: {
              id: randomUUID(),
              organizationId: invitation.organizationId,
              userId: input.userId,
              role,
              createdAt: new Date(),
            },
          })
          .catch((error: unknown) => {
            if (!isUniqueViolation(error)) throw error;
          });
        await tx.spaceMember
          .create({
            data: {
              id: randomUUID(),
              spaceId: invitation.spaceId!,
              organizationId: invitation.organizationId,
              userId: input.userId,
              role,
              createdAt: new Date(),
            },
          })
          .catch((error: unknown) => {
            if (!isUniqueViolation(error)) throw error;
          });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: INVITATION_ACCEPTED, acceptedAt: new Date() },
        });
        return { spaceId: invitation.spaceId!, name: invitation.space?.name ?? "" };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Whether this address holds an unexpired invitation into some workspace. Sign-in reads it to
 * admit someone to a deployment whose signups are closed: being invited is the admission.
 */
export async function hasPendingInvitationForEmail(
  prisma: Pick<PrismaClient, "invitation">,
  email: string | null | undefined,
): Promise<boolean> {
  const address = normalizeEmail(email);
  if (!address) return false;
  const found = await prisma.invitation.findFirst({
    where: {
      email: { equals: address, mode: "insensitive" },
      status: INVITATION_PENDING,
      spaceId: { not: null },
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(found);
}

/** The roster of a workspace. Any member may read it; that is who they are working with. */
export async function listSpaceMembers(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<SpaceMemberView[]> {
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    select: { id: true },
  });
  if (!membership) throw new IsolationError();
  const members = await prisma.spaceMember.findMany({
    where: { spaceId: input.spaceId },
    select: {
      userId: true,
      role: true,
      createdAt: true,
      member: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
  });
  return members.map((member) => ({
    userId: member.userId,
    name: member.member.user.name,
    email: member.member.user.email,
    role: member.role,
    createdAt: member.createdAt,
    isSelf: member.userId === input.userId,
  }));
}

export async function setSpaceMemberRole(
  prisma: PrismaClient,
  input: { spaceId: string; actorUserId: string; memberUserId: string; role: SpaceMemberRole },
): Promise<void> {
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await requireOwnedSpace(tx, { spaceId: input.spaceId, userId: input.actorUserId });
        const target = await tx.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: input.spaceId, userId: input.memberUserId } },
          select: { id: true, role: true },
        });
        if (!target) throw new NotSpaceMemberError();
        if (target.role === "owner" && input.role !== "owner") {
          await assertAnotherOwnerRemains(tx, input);
        }
        await tx.spaceMember.update({
          where: { id: target.id },
          data: { role: input.role },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/**
 * Removes a member's seat. Anyone may remove their own; removing someone else is the owner's
 * call. What they made stays: a bot keeps working for the workspace after its maker leaves.
 */
export async function removeSpaceMember(
  prisma: PrismaClient,
  input: { spaceId: string; actorUserId: string; memberUserId: string },
): Promise<void> {
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (input.memberUserId === input.actorUserId) {
          const own = await tx.spaceMember.findUnique({
            where: { spaceId_userId: { spaceId: input.spaceId, userId: input.actorUserId } },
            select: { id: true, role: true },
          });
          if (!own) throw new IsolationError();
          if (own.role === "owner") await assertAnotherOwnerRemains(tx, input);
          await tx.spaceMember.delete({ where: { id: own.id } });
          return;
        }
        await requireOwnedSpace(tx, { spaceId: input.spaceId, userId: input.actorUserId });
        const target = await tx.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: input.spaceId, userId: input.memberUserId } },
          select: { id: true, role: true },
        });
        if (!target) throw new NotSpaceMemberError();
        if (target.role === "owner") await assertAnotherOwnerRemains(tx, input);
        await tx.spaceMember.delete({ where: { id: target.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/** A workspace whose last owner leaves has nobody who can rename, invite or delete it. */
async function assertAnotherOwnerRemains(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; memberUserId: string },
): Promise<void> {
  const others = await tx.spaceMember.count({
    where: { spaceId: input.spaceId, role: "owner", userId: { not: input.memberUserId } },
  });
  if (others === 0) throw new CannotRemoveLastOwnerError();
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}
