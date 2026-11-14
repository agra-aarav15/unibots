import * as SecureStore from "expo-secure-store";

/**
 * The product prefix the app shipped under before it was renamed. It is kept only so a value the
 * previous release persisted can be read once and moved to its current name; nothing writes a key
 * with it.
 */
const LEGACY_KEY_PREFIX = "rakazo.";

/**
 * Every preference the app persists in SecureStore, by its name without the product prefix. On the
 * first launch after the rename each old value is copied to the new name and the old entry deleted,
 * so a rename never signs a user out or drops saved server configuration.
 */
export const MIGRATED_KEY_NAMES = [
  "activity-mode",
  "api_base",
  "artifact-cache-session",
  "call-sounds",
  "collapsed-sections",
  "device-voice",
  "expo-error-window",
  "inbox-width",
  "integrations-scope",
  "last_bot_id",
  "server_headers",
  "session_token",
  "space_id",
  "space_rollback",
  "startup-error",
  "uiLocale",
  "wait-sound",
] as const;

export interface KeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The current name of a persisted preference. */
export function storageKey(name: string): string {
  return `unibot.${name}`;
}

/** The name a persisted preference used before the rename; read once and removed. */
export function legacyStorageKey(name: string): string {
  return `${LEGACY_KEY_PREFIX}${name}`;
}

/**
 * Moves every legacy key to its current name once, leaving a value already saved under the new name
 * untouched. A failed key is retried on the next launch, when the legacy value is still readable.
 */
export async function migrateLegacyStorage(store: KeyValueStore = SecureStore): Promise<void> {
  await Promise.all(
    MIGRATED_KEY_NAMES.map(async (name) => {
      const current = storageKey(name);
      const legacy = legacyStorageKey(name);
      try {
        const previous = await store.getItemAsync(legacy);
        if (previous === null) return;
        if ((await store.getItemAsync(current)) === null) await store.setItemAsync(current, previous);
        await store.deleteItemAsync(legacy);
      } catch {
        // Storage unavailable: keep the legacy value and retry on the next launch.
      }
    }),
  );
}
