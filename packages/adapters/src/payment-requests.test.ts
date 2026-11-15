import type { PrismaClient } from "@unibot/db";
import { describe, expect, it } from "vitest";
import {
  createPaymentRequest,
  decidePaymentRequest,
  formatAmountMinor,
  getPaymentPayee,
  listPaymentRequests,
  PAYMENT_NOT_PENDING,
  PAYMENT_PAYEE_MISSING,
  PAYMENT_UNKNOWN_TICKET,
  setPaymentPayee,
} from "./payment-requests.js";

type Row = {
  id: string;
  spaceId: string;
  botId: string;
  ticketId: string | null;
  reference: string;
  method: string;
  payeeId: string;
  amountMinor: number;
  currency: string;
  description: string;
  customer: string;
  status: string;
  note: string;
  verifiedAt: Date | null;
  verifiedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The narrow slice of the client this adapter touches, so the test needs no database. */
function fakePrisma(options: { payeeId?: string | null; tickets?: string[] } = {}) {
  const rows: Row[] = [];
  const spaces = new Map<string, string | null>([["space-1", options.payeeId ?? null]]);
  const bots = new Map([["bot-1", { name: "Scout" }]]);
  const withBot = (row: Row) => ({ ...row, bot: bots.get(row.botId) ?? { name: "?" } });
  let counter = 0;

  const prisma = {
    space: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        paymentsUpiId: spaces.get(where.id) ?? null,
      }),
      update: async ({ where, data }: { where: { id: string }; data: { paymentsUpiId: string | null } }) => {
        spaces.set(where.id, data.paymentsUpiId);
        return { paymentsUpiId: data.paymentsUpiId };
      },
    },
    ticket: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        options.tickets?.includes(where.id) ? { id: where.id } : null,
    },
    paymentRequest: {
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt" | "updatedAt"> }) => {
        counter += 1;
        const row: Row = { ...data, id: `pr-${counter}`, createdAt: new Date(), updatedAt: new Date() };
        rows.push(row);
        return withBot(row);
      },
      findMany: async ({
        where,
      }: {
        where: { spaceId: string; status?: string; reference?: string; ticketId?: string };
      }) =>
        rows
          .filter(
            (row) =>
              row.spaceId === where.spaceId &&
              (!where.status || row.status === where.status) &&
              (!where.reference || row.reference === where.reference) &&
              (!where.ticketId || row.ticketId === where.ticketId),
          )
          .map(withBot),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; spaceId: string; status: string; botId?: string };
        data: Partial<Row>;
      }) => {
        const matched = rows.filter(
          (row) =>
            row.id === where.id &&
            row.spaceId === where.spaceId &&
            row.status === where.status &&
            (!where.botId || row.botId === where.botId),
        );
        for (const row of matched) Object.assign(row, data, { updatedAt: new Date() });
        return { count: matched.length };
      },
      findFirst: async ({ where }: { where: { id: string; spaceId: string } }) => {
        const row = rows.find((candidate) => candidate.id === where.id && candidate.spaceId === where.spaceId);
        return row ? withBot(row) : null;
      },
    },
  };
  return { deps: { prisma: prisma as unknown as PrismaClient }, rows };
}

const base = { spaceId: "space-1", botId: "bot-1" };

describe("createPaymentRequest", () => {
  it("refuses when the workspace has no payment address", async () => {
    const { deps } = fakePrisma({ payeeId: null });
    await expect(createPaymentRequest(deps, { ...base, amountMinor: 499_900 })).rejects.toThrow(
      PAYMENT_PAYEE_MISSING,
    );
  });

  it("snapshots the address and mints a readable reference", async () => {
    const { deps } = fakePrisma({ payeeId: "  owner@bank  " });
    const request = await createPaymentRequest(deps, {
      ...base,
      amountMinor: 499_900,
      customer: "Priya",
      description: "Landing page",
    });
    expect(request.payeeId).toBe("owner@bank");
    expect(request.reference).toMatch(/^PAY-[0-9A-Z]{6}$/);
    expect(request.status).toBe("pending");
    expect(request.botName).toBe("Scout");
    expect(request.currency).toBe("INR");
  });

  it("rejects a ticket from another space", async () => {
    const { deps } = fakePrisma({ payeeId: "owner@bank", tickets: ["ticket-1"] });
    await expect(
      createPaymentRequest(deps, { ...base, amountMinor: 100, ticketId: "ticket-missing" }),
    ).rejects.toThrow(PAYMENT_UNKNOWN_TICKET);
  });

  it("keeps the currency it was given", async () => {
    const { deps } = fakePrisma({ payeeId: "owner@bank" });
    const request = await createPaymentRequest(deps, { ...base, amountMinor: 1200, currency: "usd" });
    expect(request.currency).toBe("USD");
  });
});

describe("decidePaymentRequest", () => {
  it("settles a pending request once and refuses a second decision", async () => {
    const { deps } = fakePrisma({ payeeId: "owner@bank" });
    const created = await createPaymentRequest(deps, { ...base, amountMinor: 1000 });

    const verified = await decidePaymentRequest(deps, {
      spaceId: "space-1",
      id: created.id,
      userId: "user-1",
      status: "verified",
      note: "UPI ref 123",
    });
    expect(verified.status).toBe("verified");
    expect(verified.verifiedAt).not.toBeNull();
    expect(verified.note).toBe("UPI ref 123");

    await expect(
      decidePaymentRequest(deps, { spaceId: "space-1", id: created.id, userId: "user-1", status: "rejected" }),
    ).rejects.toThrow(PAYMENT_NOT_PENDING);
  });
});

describe("payee and listing", () => {
  it("trims the address and stores an empty one as null", async () => {
    const { deps } = fakePrisma({ payeeId: "owner@bank" });
    expect(await setPaymentPayee(deps, { spaceId: "space-1", payeeId: "  me@upi  " })).toEqual({
      payeeId: "me@upi",
    });
    expect(await setPaymentPayee(deps, { spaceId: "space-1", payeeId: "   " })).toEqual({ payeeId: null });
    expect(await getPaymentPayee(deps, "space-1")).toEqual({ payeeId: null });
  });

  it("filters by status, reference and ticket", async () => {
    const { deps } = fakePrisma({ payeeId: "owner@bank", tickets: ["ticket-1"] });
    const one = await createPaymentRequest(deps, { ...base, amountMinor: 100, ticketId: "ticket-1" });
    await createPaymentRequest(deps, { ...base, amountMinor: 200 });
    await decidePaymentRequest(deps, { spaceId: "space-1", id: one.id, userId: "u", status: "verified" });

    expect((await listPaymentRequests(deps, { spaceId: "space-1", status: "pending" })).length).toBe(1);
    expect((await listPaymentRequests(deps, { spaceId: "space-1", reference: one.reference })).length).toBe(1);
    expect((await listPaymentRequests(deps, { spaceId: "space-1", ticketId: "ticket-1" })).length).toBe(1);
  });
});

describe("formatAmountMinor", () => {
  it("shows minor units as a currency amount", () => {
    expect(formatAmountMinor(499_900, "INR")).toBe("4999.00 INR");
    expect(formatAmountMinor(1, "USD")).toBe("0.01 USD");
  });
});
