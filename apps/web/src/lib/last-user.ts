/**
 * The user this browser last ran as, kept so a reload can open on the cached space before the
 * session round trip finishes. It is an identifier for reading the local cache only — never an
 * authorisation decision; the session still decides who may see what.
 */
const LAST_USER_KEY = "rakazo.lastUser";

export function lastQueryUser(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberQueryUser(userId: string | null): void {
  try {
    if (userId) globalThis.localStorage?.setItem(LAST_USER_KEY, userId);
    else globalThis.localStorage?.removeItem(LAST_USER_KEY);
  } catch {
    // Storage disabled: the app still runs, it just starts cold.
  }
}