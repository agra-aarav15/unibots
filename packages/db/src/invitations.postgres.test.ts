import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  AlreadySpaceMemberError,
  acceptSpaceInvitation,
  CannotRemoveLastOwnerError,
  createSpaceInvitation,
  hasPendingInvitationForEmail,
  InvitationEmailMismatchError,
  InvitationNotFoundError,
  listSpaceInvitations,
  listSpaceMembers,
  NotSpaceOwnerError,
  removeSpaceMember,
  revokeSpaceInvitation,
  setSpaceMemberRole,
} from "./invitations.js";
import { asSystem, runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("workspace invitations (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `invite-organization-${suffix}`;
  const spaceId = `invite-space-${suffix}`;
  const ownerId = `invite-owner-${suffix}`;
  const memberId = `invite-member-${suffix}`;
  const strangerId = `invite-stranger-${suffix}`;
  const ownerEmail = `${ownerId}@example.test`;
  const memberEmail = `${memberId}@example.test`;
  const strangerEmail = `${strangerId}@example.test`;
  let prisma: PrismaClient;
  let fixtures: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    fixtures = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    await fixtures.user.createMany({
      data: [
        { id: ownerId, name: "Owner", email: ownerEmail },
        { id: memberId, name: "Member", email: memberEmail },
        { id: strangerId, name: "Stranger", email: strangerEmail },
      ],
    });
    await fixtures.organization.create({
      data: { id: organizationId, name: "Company", slug: organizationId, createdAt: new Date() },
    });
    await fixtures.member.createMany({
      data: [
        {
          id: `${suffix}-owner-member`,
          organizationId,
          userId: ownerId,
          role: "owner",
          createdAt: new Date(),
        },
        {
          id: `${suffix}-plain-member`,
          organizationId,
          userId: memberId,
          role: "member",
          createdAt: new Date(),
        },
        {
          id: `${suffix}-stranger-member`,
          organizationId,
          userId: strangerId,
          role: "member",
          createdAt: new Date(),
        },
      ],
    });
    await fixtures.space.create({
      data: {
        id: spaceId,
        organizationId,
        name: "Company",
        isDefault: true,
        createdByUserId: ownerId,
      },
    });
    await fixtures.spaceMember.createMany({
      data: [
        {
          id: `${suffix}-owner-seat`,
          spaceId,
          organizationId,
          userId: ownerId,
          role: "owner",
          createdAt: new Date(),
        },
        {
          id: `${suffix}-member-seat`,
          spaceId,
          organizationId,
          userId: memberId,
          role: "member",
          createdAt: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await fixtures.invitation.deleteMany({ where: { organizationId } });
    await fixtures.organization.delete({ where: { id: organizationId } });
    await fixtures.user.deleteMany({ where: { id: { in: [ownerId, memberId, strangerId] } } });
    await close();
  });

  it("lets an invited address in once, and only once", async () => {
    const invitation = await createSpaceInvitation(prisma, {
      spaceId,
      invitedByUserId: ownerId,
      email: strangerEmail,
    });
    expect(invitation.token).toEqual(expect.any(String));
    expect(invitation.role).toBe("member");
    // Holding the invitation is what admits the address, before it is used.
    expect(await hasPendingInvitationForEmail(prisma, strangerEmail)).toBe(true);
    expect(await hasPendingInvitationForEmail(prisma, "nobody@example.test")).toBe(false);

    const joined = await runAsSystem("accept an invitation", () =>
      acceptSpaceInvitation(prisma, {
        token: invitation.token,
        userId: strangerId,
        email: strangerEmail,
      }),
    );
    expect(joined).toEqual({ spaceId, name: "Company" });
    const seat = await fixtures.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: strangerId } },
    });
    expect(seat?.role).toBe("member");
    expect(await hasPendingInvitationForEmail(prisma, strangerEmail)).toBe(false);
    await expect(
      acceptSpaceInvitation(prisma, {
        token: invitation.token,
        userId: strangerId,
        email: strangerEmail,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("refuses a link addressed to somebody else", async () => {
    const invitation = await createSpaceInvitation(prisma, {
      spaceId,
      invitedByUserId: ownerId,
      email: strangerEmail,
    });
    await expect(
      acceptSpaceInvitation(prisma, {
        token: invitation.token,
        userId: memberId,
        email: memberEmail,
      }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatchError);
  });

  it("refuses an expired link", async () => {
    const invitation = await createSpaceInvitation(prisma, {
      spaceId,
      invitedByUserId: ownerId,
      email: strangerEmail,
    });
    await fixtures.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await hasPendingInvitationForEmail(prisma, strangerEmail)).toBe(false);
    await expect(
      acceptSpaceInvitation(prisma, {
        token: invitation.token,
        userId: strangerId,
        email: strangerEmail,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("replaces an earlier pending link for the same address", async () => {
    const first = await createSpaceInvitation(prisma, {
      spaceId,
      invitedByUserId: ownerId,
      email: memberEmail,
    });
    const second = await createSpaceInvitation(prisma, {
      spaceId,
      invitedByUserId: ownerId,
      email: memberEmail,
    });
    const pending = await listSpaceInvitations(prisma, { spaceId, userId: ownerId });
    expect(pending.map((row) => row.id)).toContain(second.id);
    expect(pending.map((row) => row.id)).not.toContain(first.id);
    await expect(
      acceptSpaceInvitation(prisma, {
        token: first.token,
        userId: memberId,
        email: memberEmail,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("mints and revokes links only for an owner", async () => {
    await expect(
      createSpaceInvitation(prisma, { spaceId, invitedByUserId: memberId }),
    ).rejects.toBeInstanceOf(NotSpaceOwnerError);
    await expect(
      listSpaceInvitations(prisma, { spaceId, userId: memberId }),
    ).rejects.toBeInstanceOf(NotSpaceOwnerError);
    const invitation = await createSpaceInvitation(prisma, { spaceId, invitedByUserId: ownerId });
    expect(invitation.email).toBeNull();
    await revokeSpaceInvitation(prisma, {
      spaceId,
      userId: ownerId,
      invitationId: invitation.id,
    });
    await expect(
      acceptSpaceInvitation(prisma, {
        token: invitation.token,
        userId: strangerId,
        email: strangerEmail,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it("refuses to invite someone already in the workspace", async () => {
    await expect(
      createSpaceInvitation(prisma, { spaceId, invitedByUserId: ownerId, email: memberEmail }),
    ).rejects.toBeInstanceOf(AlreadySpaceMemberError);
  });

  it("shows the roster to a member and keeps the last owner in place", async () => {
    const roster = await listSpaceMembers(prisma, { spaceId, userId: memberId });
    expect(roster.find((row) => row.isSelf)?.userId).toBe(memberId);
    expect(roster.find((row) => row.userId === ownerId)?.role).toBe("owner");

    await setSpaceMemberRole(prisma, {
      spaceId,
      actorUserId: ownerId,
      memberUserId: memberId,
      role: "owner",
    });
    // Two owners, so one of them may step down and the other may not.
    await expect(
      setSpaceMemberRole(prisma, {
        spaceId,
        actorUserId: ownerId,
        memberUserId: memberId,
        role: "member",
      }),
    ).resolves.toBeUndefined();
    await expect(
      removeSpaceMember(prisma, { spaceId, actorUserId: ownerId, memberUserId: ownerId }),
    ).rejects.toBeInstanceOf(CannotRemoveLastOwnerError);
    // A member may leave on their own.
    await expect(
      removeSpaceMember(prisma, { spaceId, actorUserId: memberId, memberUserId: memberId }),
    ).resolves.toBeUndefined();
    expect(await fixtures.spaceMember.count({ where: { spaceId, userId: memberId } })).toBe(0);
  });
});
