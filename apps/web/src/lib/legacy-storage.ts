/**
 * Renaming a persisted storage key would drop what a browser already saved, so every module that
 * owns a renamed key reads the old name once, copies it to the new name and clears the old one.
 * This is the shape `last-user.ts` established; these helpers keep it in one place.
 */
type ReadableStorage = Pick<Storage, "getItem"> &
  Partial<Pick<Storage, "setItem" | "removeItem">>;
type RemovableStorage = Partial<Pick<Storage, "setItem" | "removeItem">>;

/** Reads the current key, or moves the pre-rename name forward the one time it is found. */
export function readMigratedKey(
  storage: ReadableStorage,
  key: string,
  legacyKey: string,
): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const previous = storage.getItem(legacyKey);
  if (previous === null) return null;
  storage.setItem?.(key, previous);
  storage.removeItem?.(legacyKey);
  return previous;
}

/** Clears a key's pre-rename name once its value has been written under the new name. */
export function clearLegacyKey(storage: RemovableStorage, legacyKey: string): void {
  storage.removeItem?.(legacyKey);
}

/** Moves every entry saved under a renamed key prefix to the new prefix, so drafts survive. */
export function migrateLegacyKeyPrefix(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> &
    Partial<Pick<Storage, "length" | "key">>,
  prefix: string,
  legacyPrefix: string,
): void {
  const readKey = storage.key;
  const total = storage.length;
  if (typeof total !== "number" || typeof readKey !== "function") return;
  const names: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const name = readKey.call(storage, index);
    if (name) names.push(name);
  }
  for (const name of names) {
    if (!name.startsWith(legacyPrefix)) continue;
    const value = storage.getItem(name);
    if (value === null) continue;
    storage.setItem(`${prefix}${name.slice(legacyPrefix.length)}`, value);
    storage.removeItem(name);
  }
}
