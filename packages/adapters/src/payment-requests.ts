import { randomBytes } from "node:crypto";
import type { PaymentRequest as PaymentRequestDto, PaymentStatus } from "@unibot/contracts";
import type { Prisma, PrismaClient } from "@unibot/db";

/**
 * Payment requests: what a bot asked a customer for, and the owner's own confirmation that the
 * money arrived. Nothing here contacts a bank or a payment provider — the owner is the authority
 * on whether money was received, and the bot only proceeds once that is recorded.
 */

export type PaymentRequestDeps = {
  prisma: PrismaClient;
};

export const PAYMENT_PAYEE_MISSING =
  "This workspace has no payment address yet. Set a UPI ID before requesting payment.";
export const PAYMENT_NOT_PENDING = "This payment request has already been settled.";
export const PAYMENT_UNKNOWN = "Unknown payment request.";
export const PAYMENT_UNKNOWN_TICKET = "Unknown ticket.";
export const PAYMENT_DEFAULT_CURRENCY = "INR";

/** A minor-unit amount as a person reads it. Two decimals is right for the currencies in use. */
export function formatAmountMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

type PaymentRequestRow = Prisma.PaymentRequestGetPayload<{
  include: { bot: { select: { name: true } } };
}>;

function toDto(row: PaymentRequestRow): PaymentRequestDto {
  return {
    id: row.id,
    spaceId: row.spaceId,
    botId: row.botId,
    botName: row.bot.name,
    ticketId: row.ticketId,
    reference: row.reference,
    method: row.method as PaymentRequestDto["method"],
    payeeId: row.payeeId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    description: row.description,
    customer: row.customer,
    status: row.status as PaymentStatus,
    note: row.note,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Crockford base32, minus the letters that look like numbers, so a reference is readable aloud. */
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newReference(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const byte of bytes) code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `PAY-${code}`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export type CreatePaymentRequestFields = {
  spaceId: string;
  botId: string;
  amountMinor: number;
  currency?: string;
  description?: string;
  customer?: string;
  ticketId?: string;
};

/**
 * Records a request. The payee is snapshotted from the space, so changing the workspace's UPI ID
 * never rewrites what a customer was already told to pay.
 */
export async function createPaymentRequest(
  deps: PaymentRequestDeps,
  input: CreatePaymentRequestFields,
): Promise<PaymentRequestDto> {
  const space = await deps.prisma.space.findUnique({
    where: { id: input.spaceId },
    select: { paymentsUpiId: true },
  });
  const payeeId = space?.paymentsUpiId?.trim();
  if (!payeeId) throw new Error(PAYMENT_PAYEE_MISSING);
  if (input.ticketId) {
    const ticket = await deps.prisma.ticket.findFirst({
      where: { id: input.ticketId, spaceId: input.spaceId },
      select: { id: true },
    });
    if (!ticket) throw new Error(PAYMENT_UNKNOWN_TICKET);
  }
  const currency = (input.currency ?? PAYMENT_DEFAULT_CURRENCY).trim().toUpperCase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const row = await deps.prisma.paymentRequest.create({
        data: {
          spaceId: input.spaceId,
          botId: input.botId,
          ticketId: input.ticketId ?? null,
          reference: newReference(),
          method: "upi",
          payeeId,
          amountMinor: input.amountMinor,
          currency,
          description: input.description ?? "",
          customer: input.customer ?? "",
          status: "pending",
        },
        include: { bot: { select: { name: true } } },
      });
      return toDto(row);
    } catch (error) {
      // The reference is unique per space; a clash is retried, anything else is real.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Could not allocate a payment reference.");
}

export async function listPaymentRequests(
  deps: PaymentRequestDeps,
  input: { spaceId: string; status?: PaymentStatus; reference?: string; ticketId?: string },
): Promise<PaymentRequestDto[]> {
  const rows = await deps.prisma.paymentRequest.findMany({
    where: {
      spaceId: input.spaceId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.ticketId ? { ticketId: input.ticketId } : {}),
    },
    include: { bot: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return rows.map(toDto);
}

export type DecidePaymentRequestFields = {
  spaceId: string;
  id: string;
  userId: string;
  status: Extract<PaymentStatus, "verified" | "rejected" | "cancelled">;
  note?: string;
  /** The bot that cancels its own request; absent when the owner decides. */
  botId?: string;
};

/** The one place a request leaves `pending`, so it can never be settled twice by a race. */
export async function decidePaymentRequest(
  deps: PaymentRequestDeps,
  input: DecidePaymentRequestFields,
): Promise<PaymentRequestDto> {
  const settled = await deps.prisma.paymentRequest.updateMany({
    where: {
      id: input.id,
      spaceId: input.spaceId,
      status: "pending",
      ...(input.botId ? { botId: input.botId } : {}),
    },
    data: {
      status: input.status,
      note: input.note ?? "",
      verifiedAt: input.status === "verified" ? new Date() : null,
      verifiedById: input.userId,
    },
  });
  const row = await deps.prisma.paymentRequest.findFirst({
    where: { id: input.id, spaceId: input.spaceId },
    include: { bot: { select: { name: true } } },
  });
  if (!row) throw new Error(PAYMENT_UNKNOWN);
  if (settled.count === 0) throw new Error(PAYMENT_NOT_PENDING);
  return toDto(row);
}

export async function getPaymentPayee(
  deps: PaymentRequestDeps,
  spaceId: string,
): Promise<{ payeeId: string | null }> {
  const space = await deps.prisma.space.findUnique({
    where: { id: spaceId },
    select: { paymentsUpiId: true },
  });
  return { payeeId: space?.paymentsUpiId?.trim() || null };
}

export async function setPaymentPayee(
  deps: PaymentRequestDeps,
  input: { spaceId: string; payeeId: string },
): Promise<{ payeeId: string | null }> {
  const trimmed = input.payeeId.trim();
  await deps.prisma.space.update({
    where: { id: input.spaceId },
    data: { paymentsUpiId: trimmed || null },
  });
  return { payeeId: trimmed || null };
}
