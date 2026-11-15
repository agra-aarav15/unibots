import * as z from "zod";
import { Id } from "./ids.js";

/**
 * A payment a bot asked a customer for. Money moves outside the app (UPI, or whatever the owner
 * uses); this records what was asked and the owner's own confirmation that it arrived, so a bot
 * never promises delivery on money it has not been told about. The agent-spending wallet lives in
 * `payments.ts`; this is the opposite direction — money coming in.
 */

export const PAYMENT_STATUSES = ["pending", "verified", "rejected", "cancelled"] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PAYMENT_METHODS = ["upi"] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PAYMENT_DESCRIPTION_MAX_LENGTH = 500;
export const PAYMENT_CUSTOMER_MAX_LENGTH = 200;
export const PAYMENT_NOTE_MAX_LENGTH = 500;
export const PAYMENT_PAYEE_MAX_LENGTH = 120;
/** Amounts are whole minor units (paise), so no floating point is ever involved. */
export const PAYMENT_AMOUNT_MAX_MINOR = 1_000_000_000;

export const PaymentRequestSchema = z.object({
  id: Id,
  spaceId: Id,
  botId: Id,
  botName: z.string(),
  ticketId: Id.nullable(),
  reference: z.string(),
  method: PaymentMethodSchema,
  /** The address the payer sends money to, snapshotted when the request was made. */
  payeeId: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string(),
  description: z.string(),
  customer: z.string(),
  status: PaymentStatusSchema,
  note: z.string(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

export const ListPaymentRequestsInput = z.object({
  status: PaymentStatusSchema.optional(),
});
export type ListPaymentRequestsInput = z.infer<typeof ListPaymentRequestsInput>;

export const ListPaymentRequestsOutput = z.object({ requests: z.array(PaymentRequestSchema) });
export type ListPaymentRequestsOutput = z.infer<typeof ListPaymentRequestsOutput>;

export const VerifyPaymentRequestInput = z.object({
  id: Id,
  note: z.string().max(PAYMENT_NOTE_MAX_LENGTH).optional(),
});
export type VerifyPaymentRequestInput = z.infer<typeof VerifyPaymentRequestInput>;

export const PaymentPayeeSchema = z.object({ payeeId: z.string().nullable() });
export type PaymentPayee = z.infer<typeof PaymentPayeeSchema>;

export const SetPaymentPayeeInput = z.object({
  payeeId: z.string().trim().max(PAYMENT_PAYEE_MAX_LENGTH),
});
export type SetPaymentPayeeInput = z.infer<typeof SetPaymentPayeeInput>;
