import { randomBytes } from "node:crypto";
import { bootstrapUserSpace } from "@unibot/db";
import type { PrismaClient } from "@unibot/db";

/**
 * `AUTH_MODE=local`: the machine this server runs on is the identity. One owner is provisioned on
 * first boot and every request is that owner, so nobody signs in and there is no login page.
 *
 * Only the loopback bind makes this safe — see the check in `createApp`, which refuses to start
 * local mode on a host another machine could reach. Nothing here weakens authorization for the
 * usual `session` mode: the owner is resolved only when that mode is on.
 */

/** The owner of a local machine. Never emailed, so no deliverable address is needed. */
const LOCAL_OWNER_EMAIL = "owner@localhost";

export type LocalOwner = { id: string; name: string; email: string };

export type LocalOwnerLookup = {
  /** The owner and their space, created on first use and reused afterwards. */
  ensure: () => Promise<LocalOwner>;
};

export function createLocalOwnerLookup(prisma: PrismaClient): LocalOwnerLookup {
  let pending: Promise<LocalOwner> | undefined;
  return {
    ensure: () => {
      // One provisioning per process: concurrent first requests must not race on signup.
      pending ??= provision(prisma).catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  };
}

async function provision(prisma: PrismaClient): Promise<LocalOwner> {
  // The machine's owner is whoever already owns it: a deployment that has accounts keeps them,
  // so turning on local mode never swaps the screen to a different, empty workspace. Only a
  // database with no accounts at all gets the synthetic owner.
  const existing = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  if (existing) return existing;
  const owner =
    existing ??
    (await prisma.user.create({
      data: {
        id: randomBytes(16).toString("hex"),
        name: "Owner",
        email: LOCAL_OWNER_EMAIL,
        // Nobody can receive a verification message on a machine with no mail provider.
        emailVerified: true,
      },
      select: { id: true, name: true, email: true },
    }));
  // Signs up nothing and grants no administration; it provisions the personal space and the
  // defaults a first sign-up would have, and is idempotent for an owner that already has them.
  const membership = await prisma.spaceMember.findFirst({ where: { userId: owner.id } });
  if (!membership) {
    await bootstrapUserSpace(prisma, owner, { signupsEnabled: "true", signupAllowlist: "" });
  }
  return owner;
}