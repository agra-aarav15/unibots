import { createHmac, randomInt } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  isLoopbackHost,
  isPrivateNetworkHost,
} from "@rakazo/contracts";
import { recordSecurityEvent, runAsSystem } from "@rakazo/db";
import type { RouterContext } from "./context.js";

/** Five wrong codes from one device close the door for the rest of the code's life. */
const ATTEMPT_WINDOW_MS = PAIRING_CODE_TTL_MS;
const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Per-client attempt counter. Pairing only runs on the app-managed local stack, which is
 * one process, so this counter is authoritative there; a VPS path uses normal sign-in.
 */
export function allowPairingAttempt(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= PAIRING_MAX_ATTEMPTS;
}

/** Fails every redemption the same way, so a probe cannot tell a code exists. */
function pairingFailed() {
  return new ORPCError("BAD_REQUEST", { message: "That code is not valid. Start again." });
}

/**
 * A phone may pair over HTTPS anywhere, or plain HTTP only on a loopback or private
 * network address. A public HTTP address would send the session token in the clear.
 */
export function pairingUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isLoopbackHost(host) || isPrivateNetworkHost(host) ? url.origin : null;
}

function codeHash(secret: string, code: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function pairingRoutes(ctx: RouterContext) {
  const { deps, authed, os } = ctx;
  return {
    pairing: {
      create: authed.pairing.create.handler(async ({ context, input }) => {
        const secret = deps.env.pairingSecret;
        if (!deps.env.desktopManaged || !secret) throw new ORPCError("NOT_FOUND");
        const url = pairingUrl(input.url);
        if (!url) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Use this computer's private network address or an HTTPS address.",
          });
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
        // One live code per person: asking again replaces the previous one.
        await deps.prisma.devicePairing.deleteMany({
          where: { userId: context.actor.userId, usedAt: null },
        });
        await deps.prisma.devicePairing.create({
          data: {
            userId: context.actor.userId,
            spaceId: context.actor.spaceId,
            codeHash: codeHash(secret, code),
            apiUrl: url,
            expiresAt,
          },
        });
        return { url, code, expiresAt: expiresAt.toISOString() };
      }),
    },
    device: {
      // Not `authed`: the phone has no session yet, and pairing never creates an account.
      pair: os.device.pair.handler(async ({ context, input }) => {
        const secret = deps.env.pairingSecret;
        if (!deps.env.desktopManaged || !secret) throw new ORPCError("NOT_FOUND");
        if (!allowPairingAttempt(context.ip ?? "unknown")) throw pairingFailed();
        return runAsSystem("redeem a device pairing code", async () => {
          const now = new Date();
          const row = await deps.prisma.devicePairing.findUnique({
            where: { codeHash: codeHash(secret, input.code) },
            select: {
              id: true,
              userId: true,
              spaceId: true,
              apiUrl: true,
              expiresAt: true,
              usedAt: true,
            },
          });
          if (!row || row.usedAt !== null || row.expiresAt <= now) throw pairingFailed();
          // Compare-and-set claims the code, so two phones racing it cannot both pair.
          const claimed = await deps.prisma.devicePairing.updateMany({
            where: { id: row.id, usedAt: null },
            data: { usedAt: now },
          });
          if (claimed.count === 0) throw pairingFailed();

          const user = await deps.prisma.user.findUnique({
            where: { id: row.userId },
            select: { id: true, name: true, email: true },
          });
          if (!user) throw pairingFailed();
          const auth = await deps.auth.$context;
          const session = await auth.internalAdapter.createSession(row.userId, true);
          // The bearer plugin verifies `<token>.<HMAC-SHA256(token)>` with the auth secret.
          const signature = createHmac("sha256", auth.secret).update(session.token).digest("base64");
          await recordSecurityEvent({
            type: "device.paired",
            userId: row.userId,
            spaceId: row.spaceId,
            metadata: { platform: input.platform },
          });
          return {
            token: `${session.token}.${signature}`,
            user: { id: user.id, name: user.name, email: user.email },
            spaceId: row.spaceId,
            apiUrl: row.apiUrl,
          };
        });
      }),
    },
  };
}