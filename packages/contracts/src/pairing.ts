import * as z from "zod";

/** Six digits, the only thing a person types on the phone. */
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const PAIRING_CODE_PATTERN = /^\d{6}$/;

export const PairingCodeSchema = z.string().regex(PAIRING_CODE_PATTERN);

export const DevicePairingSchema = z.object({
  /** The LAN address the phone should use, always private HTTP or HTTPS. */
  url: z.string().url(),
  code: PairingCodeSchema,
  expiresAt: z.string().datetime(),
});

export const CreateDevicePairingInputSchema = z.object({
  /** The desktop's detected LAN URL; validated as private HTTP or HTTPS. */
  url: z.string().url(),
});

export const DevicePlatformSchema = z.enum(["ios", "android"]);

export const PairDeviceInputSchema = z.object({
  code: PairingCodeSchema,
  deviceName: z.string().trim().min(1).max(80),
  platform: DevicePlatformSchema,
});

export const PairDeviceOutputSchema = z.object({
  /** A signed bearer token; the phone stores it exactly like a sign-in token. */
  token: z.string().min(1),
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  spaceId: z.string(),
  apiUrl: z.string().url(),
});

export type DevicePairing = z.infer<typeof DevicePairingSchema>;
export type PairDeviceInput = z.infer<typeof PairDeviceInputSchema>;
export type PairDeviceOutput = z.infer<typeof PairDeviceOutputSchema>;