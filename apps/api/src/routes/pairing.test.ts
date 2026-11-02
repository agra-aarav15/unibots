import { createHmac } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import { PAIRING_CODE_TTL_MS, PAIRING_MAX_ATTEMPTS } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";
import { allowPairingAttempt, pairingUrl } from "./pairing.js";

const AUTH_SECRET = "pairing-test-auth-secret";

describe("pairingUrl", () => {
  it("accepts HTTPS anywhere", () => {
    expect(pairingUrl("https://home.example.com")).toBe("https://home.example.com");
    expect(pairingUrl("https://home.example.com:8443")).toBe("https://home.example.com:8443");
  });

  it("accepts plain HTTP only on loopback or a private network", () => {
    expect(pairingUrl("http://192.168.1.24:3100")).toBe("http://192.168.1.24:3100");
    expect(pairingUrl("http://10.0.0.5:3100")).toBe("http://10.0.0.5:3100");
    expect(pairingUrl("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(pairingUrl("http://localhost:3100")).toBe("http://localhost:3100");
  });

  it("refuses a public HTTP address, credentials in the URL, and other schemes", () => {
    expect(pairingUrl("http://app.example.com")).toBeNull();
    expect(pairingUrl("http://user:pass@192.168.1.24:3100")).toBeNull();
    expect(pairingUrl("file:///etc/passwd")).toBeNull();
    expect(pairingUrl("not a url")).toBeNull();
  });
});

describe("allowPairingAttempt", () => {
  it("locks a client after the attempt limit and frees it when the window passes", () => {
    const key = `test-${Math.random()}`;
    for (let attempt = 0; attempt < PAIRING_MAX_ATTEMPTS; attempt += 1) {
      expect(allowPairingAttempt(key, 1_000), String(attempt)).toBe(true);
    }
    expect(allowPairingAttempt(key, 1_000)).toBe(false);
    // One millisecond past the five-minute window the client may try again.
    expect(allowPairingAttempt(key, 1_000 + 5 * 60_000 + 1)).toBe(true);
  });

  it("counts each client separately", () => {
    const first = `test-${Math.random()}`;
    const second = `test-${Math.random()}`;
    for (let attempt = 0; attempt < PAIRING_MAX_ATTEMPTS; attempt += 1) allowPairingAttempt(first, 0);
    expect(allowPairingAttempt(first, 0)).toBe(false);
    expect(allowPairingAttempt(second, 0)).toBe(true);
  });
});

const ACTOR = {
  spaceId: "ws-1",
  userId: "user-1",
  email: "owner@example.test",
  isDeploymentOwner: true,
};

const USER = { id: "user-1", name: "Owner", email: "owner@example.test" };

type PairingRow = {
  id: string;
  userId: string;
  spaceId: string;
  codeHash: string;
  apiUrl: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
};

function pairingDeps(options: { desktopManaged?: boolean; secret?: string } = {}) {
  const rows: PairingRow[] = [];
  const deleteMany = vi.fn(async ({ where }: { where: { userId: string; usedAt: null } }) => {
    const before = rows.length;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]!.userId === where.userId && rows[index]!.usedAt === null) rows.splice(index, 1);
    }
    return { count: before - rows.length };
  });
  const create = vi.fn(async ({ data }: { data: Omit<PairingRow, "id" | "attempts" | "usedAt" | "createdAt"> }) => {
    const row: PairingRow = {
      id: `pair-${rows.length + 1}`,
      attempts: 0,
      usedAt: null,
      createdAt: new Date(),
      ...data,
    };
    rows.push(row);
    return row;
  });
  const findUnique = vi.fn(
    async ({ where }: { where: { codeHash: string } }) =>
      rows.find((row) => row.codeHash === where.codeHash) ?? null,
  );
  const updateMany = vi.fn(
    async ({ where, data }: { where: { id: string; usedAt: null }; data: { usedAt: Date } }) => {
      const row = rows.find((candidate) => candidate.id === where.id && candidate.usedAt === null);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  );
  const findUser = vi.fn(async ({ where }: { where: { id: string } }) =>
    where.id === USER.id ? USER : null,
  );
  const createSession = vi.fn(async () => ({ token: "session-token" }));
  const prisma = {
    devicePairing: { deleteMany, create, findUnique, updateMany },
    user: { findUnique: findUser },
    securityEvent: { create: vi.fn(async ({ data }: { data: unknown }) => ({ id: "evt-1", ...(data as object) })) },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    auth: {
      $context: Promise.resolve({
        internalAdapter: { createSession },
        secret: AUTH_SECRET,
      }),
    },
    env: {
      desktopManaged: options.desktopManaged ?? true,
      pairingSecret: options.secret ?? "pairing-secret",
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-screen-secret",
      sandboxProvider: "fake",
      agentRuntime: "scripted",
    },
    dataDir: "/tmp/rakazo-pairing-test",
  } as unknown as RouterDeps;
  return { deps, rows, deleteMany, create, updateMany, createSession };
}

function client(deps: RouterDeps, context: Record<string, unknown>) {
  return createRouterClient(createRouter(deps), { context: context as never });
}

function hash(secret: string, code: string) {
  return createHmac("sha256", secret).update(code).digest("hex");
}

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `192.0.2.${ipCounter}`;
}

describe("pairing.create", () => {
  it("stores only a hash and replaces the previous live code", async () => {
    const { deps, rows, deleteMany } = pairingDeps();
    const rpc = client(deps, { actor: ACTOR });

    const first = await rpc.pairing.create({ url: "http://192.168.1.24:3100" });
    expect(first.code).toMatch(/^\d{6}$/);
    expect(first.url).toBe("http://192.168.1.24:3100");
    expect(Date.parse(first.expiresAt) - Date.now()).toBeLessThanOrEqual(PAIRING_CODE_TTL_MS);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).toBe(hash("pairing-secret", first.code));
    expect(JSON.stringify(rows[0])).not.toContain(first.code);

    const second = await rpc.pairing.create({ url: "http://192.168.1.24:3100" });
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).toBe(hash("pairing-secret", second.code));
  });

  it("rejects a public HTTP origin", async () => {
    const { deps } = pairingDeps();
    const rpc = client(deps, { actor: ACTOR });
    await expect(rpc.pairing.create({ url: "http://app.example.com" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("is not reachable outside the app-managed local stack", async () => {
    const { deps } = pairingDeps({ desktopManaged: false });
    const rpc = client(deps, { actor: ACTOR });
    await expect(
      rpc.pairing.create({ url: "http://192.168.1.24:3100" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires a signed-in owner", async () => {
    const { deps } = pairingDeps();
    const rpc = client(deps, {});
    await expect(
      rpc.pairing.create({ url: "http://192.168.1.24:3100" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("device.pair", () => {
  async function redeemable(options: { expiresAt?: Date; usedAt?: Date | null } = {}) {
    const setup = pairingDeps();
    const rpc = client(setup.deps, { actor: ACTOR });
    const pairing = await rpc.pairing.create({ url: "http://192.168.1.24:3100" });
    const row = setup.rows[0]!;
    if (options.expiresAt) row.expiresAt = options.expiresAt;
    if (options.usedAt !== undefined) row.usedAt = options.usedAt;
    return { ...setup, pairing, row };
  }

  it("returns a signed bearer token and marks the code used", async () => {
    const { deps, pairing, row, updateMany, createSession } = await redeemable();
    const phone = client(deps, { ip: freshIp() });
    const result = await phone.device.pair({
      code: pairing.code,
      deviceName: "Phone",
      platform: "android",
    });
    const signature = createHmac("sha256", AUTH_SECRET).update("session-token").digest("base64");
    expect(result).toEqual({
      token: `session-token.${signature}`,
      user: USER,
      spaceId: "ws-1",
      apiUrl: "http://192.168.1.24:3100",
    });
    expect(createSession).toHaveBeenCalledWith("user-1", true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: row.id, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(row.usedAt).toBeInstanceOf(Date);
  });

  it("refuses a code that was already used", async () => {
    const { deps, pairing } = await redeemable({ usedAt: new Date() });
    const phone = client(deps, { ip: freshIp() });
    await expect(
      phone.device.pair({ code: pairing.code, deviceName: "Phone", platform: "ios" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses an expired code", async () => {
    const { deps, pairing } = await redeemable({ expiresAt: new Date(Date.now() - 1_000) });
    const phone = client(deps, { ip: freshIp() });
    await expect(
      phone.device.pair({ code: pairing.code, deviceName: "Phone", platform: "ios" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a second phone racing for the same code", async () => {
    const { deps, pairing, updateMany } = await redeemable();
    updateMany.mockResolvedValueOnce({ count: 0 });
    const phone = client(deps, { ip: freshIp() });
    await expect(
      phone.device.pair({ code: pairing.code, deviceName: "Phone", platform: "android" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("gives the same generic error for an unknown code", async () => {
    const { deps } = pairingDeps();
    const phone = client(deps, { ip: freshIp() });
    await expect(
      phone.device.pair({ code: "000000", deviceName: "Phone", platform: "android" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "That code is not valid. Start again." });
  });

  it("locks a device after five wrong codes, even for a correct one", async () => {
    const { deps, pairing } = await redeemable();
    const ip = freshIp();
    const phone = client(deps, { ip });
    for (let attempt = 0; attempt < PAIRING_MAX_ATTEMPTS; attempt += 1) {
      await expect(
        phone.device.pair({ code: "999999", deviceName: "Phone", platform: "android" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      phone.device.pair({ code: pairing.code, deviceName: "Phone", platform: "android" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is not reachable when the LAN overlay is off", async () => {
    const { deps } = pairingDeps({ desktopManaged: false });
    const phone = client(deps, { ip: freshIp() });
    await expect(
      phone.device.pair({ code: "000000", deviceName: "Phone", platform: "android" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
