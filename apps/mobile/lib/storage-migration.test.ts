import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import {
  legacyStorageKey,
  MIGRATED_KEY_NAMES,
  migrateLegacyStorage,
  storageKey,
} from "./storage-migration";

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

describe("legacy storage migration", () => {
  it("moves every preference saved under the old name to its current name", async () => {
    const store = memoryStore(
      Object.fromEntries(
        MIGRATED_KEY_NAMES.map((name) => [legacyStorageKey(name), `value:${name}`]),
      ),
    );

    await migrateLegacyStorage(store);

    for (const name of MIGRATED_KEY_NAMES) {
      expect(store.values.get(storageKey(name))).toBe(`value:${name}`);
      expect(store.values.has(legacyStorageKey(name))).toBe(false);
    }
  });

  it("prefers a value already saved under the current name", async () => {
    const store = memoryStore({
      [storageKey("session_token")]: "new-token",
      [legacyStorageKey("session_token")]: "old-token",
    });

    await migrateLegacyStorage(store);

    expect(store.values.get(storageKey("session_token"))).toBe("new-token");
    expect(store.values.has(legacyStorageKey("session_token"))).toBe(false);
  });

  it("leaves storage untouched when no old value is present", async () => {
    const store = memoryStore();

    await migrateLegacyStorage(store);

    expect(store.setItemAsync).not.toHaveBeenCalled();
    expect(store.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("keeps the old value when storage is unavailable", async () => {
    const store = {
      getItemAsync: vi.fn(async () => {
        throw new Error("device locked");
      }),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };

    await expect(migrateLegacyStorage(store)).resolves.toBeUndefined();
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});
