import { isLoopbackHost, isPrivateNetworkHost } from "@rakazo/contracts";
import { clearSpace, normalizeApiBase, saveApiBase } from "./api";
import { saveSessionToken } from "./session";
import { errorText } from "./user-error";

export const PAIRING_CODE_LENGTH = 6;
const PAIRING_TIMEOUT_MS = 20_000;

/** A phone may pair over HTTPS, or plain HTTP only on a private or loopback address. */
export function pairingUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Never send a session token to a URL that carries its own credentials.
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  return isLoopbackHost(host) || isPrivateNetworkHost(host);
}

/**
 * Redeems a code the desktop showed. On success this device is signed in exactly like
 * a password sign-in: the base address and bearer token are stored, and the Space is
 * resolved on the next request.
 */
export async function pairWithComputer(input: {
  url: string;
  code: string;
  deviceName: string;
  platform: "ios" | "android";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = normalizeApiBase(input.url);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  if (!pairingUrlAllowed(normalized.url)) {
    return {
      ok: false,
      error: "Use HTTPS, or the computer's private network address for phone access.",
    };
  }
  if (!new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`).test(input.code.trim())) {
    return { ok: false, error: "Enter the 6-digit code from the computer." };
  }

  let response: Response;
  try {
    response = await fetch(`${normalized.url}/rpc/device/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "rakazo://" },
      body: JSON.stringify({
        json: {
          code: input.code.trim(),
          deviceName: input.deviceName.slice(0, 80),
          platform: input.platform,
        },
      }),
      signal: AbortSignal.timeout(PAIRING_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not reach the computer. Check the address and the network." };
  }
  const body = (await response.json().catch(() => null)) as
    | { json?: { token?: unknown; apiUrl?: unknown; message?: unknown } }
    | null;
  if (!response.ok) {
    const message = body?.json?.message;
    return {
      ok: false,
      error: typeof message === "string" ? errorText(message) : "That code is not valid.",
    };
  }
  const token = body?.json?.token;
  const apiUrl = body?.json?.apiUrl;
  if (typeof token !== "string" || token === "" || typeof apiUrl !== "string" || apiUrl === "") {
    return { ok: false, error: "The computer did not return a session. Try again." };
  }
  const saved = await saveApiBase(apiUrl);
  if (!saved.ok) return { ok: false, error: saved.error };
  try {
    // A previous account's Space must not leak into the paired session.
    if (!(await clearSpace())) throw new Error("space");
    await saveSessionToken(token);
  } catch {
    return { ok: false, error: "Could not save the sign-in on this device. Try again." };
  }
  return { ok: true };
}