/**
 * A workspace invitation the person has not accepted yet. It is parked here because the link's
 * token has to survive whatever stands between opening it and being signed in: a sign-up, a
 * sign-in, or an email verification round trip that replaces the query string.
 */
const PENDING_INVITE_KEY = "rakazo:invite";

export function rememberInvite(token: string): void {
  try {
    window.localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Storage is a convenience here; the link in the address bar still works on its own.
  }
}

export function pendingInvite(): string | null {
  try {
    return window.localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

/** Called once the link is spent, accepted or refused, so it is never tried twice. */
export function forgetInvite(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
