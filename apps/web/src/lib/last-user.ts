/**
 * The user this browser last ran as, kept so a reload can open on the cached space before the
 * session round trip finishes. It is an identifier for reading the local cache only — never an
 * authorisation decision; the session still decides who may see what.
 */
const LAST_USER_KEY = "unibot.lastUser";
/** Where this shipped before the rename. Read once and moved forward, so nobody starts cold. */
const LEGACY_LAST_USER_KEY = "rakazo.lastUser";

export function lastQueryUser(): string | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const current = storage.getItem(LAST_USER_KEY);
    if (current !== null) return current;
    const previous = storage.getItem(LEGACY_LAST_USER_KEY);
    if (previous === null) return null;
    storage.setItem(LAST_USER_KEY, previous);
    storage.removeItem(LEGACY_LAST_USER_KEY);
    return previous;
  } catch {
    return null;
  }
}

export function rememberQueryUser(userId: string | null): void {
  try {
    const storage = globalThis.localStorage;
    if (userId) {
      storage?.setItem(LAST_USER_KEY, userId);
      storage?.removeItem(LEGACY_LAST_USER_KEY);
    } else {
      storage?.removeItem(LAST_USER_KEY);
    }
  } catch {
    // Storage disabled: the app still runs, it just starts cold.
  }
}