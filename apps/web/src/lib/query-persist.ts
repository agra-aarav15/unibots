import type { DehydratedState, QueryKey, QueryClient } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { lastQueryUser } from "./last-user";

/**
 * Screens reopen on what this browser last saw, the way a phone app does. The query cache is
 * written to IndexedDB and read back before React mounts, so a reload paints the space instead
 * of an empty shell while the network catches up.
 *
 * The cache holds user content, so it is scoped to the user it was written for: a snapshot left
 * by another account is dropped rather than shown.
 */

const DB_NAME = "unibot-query-cache";
const STORE = "snapshots";
const RECORD = "latest";
/** Bumped when a cached shape changes, so stale entries are dropped instead of misread. */
const CACHE_VERSION = 1;
/** A single space snapshot is the largest thing here; anything past this is not worth the read. */
const MAX_ENTRY_BYTES = 512 * 1024;
/** The whole snapshot is bounded too, so a cold read stays a few milliseconds. */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const HYDRATE_TIMEOUT_MS = 250;
const SAVE_DEBOUNCE_MS = 1_000;

type StoredSnapshot = {
  version: number;
  userId: string | null;
  savedAt: number;
  state: DehydratedState;
};

function indexedDb(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB ?? undefined;
  } catch {
    return undefined;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = indexedDb();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readRecord(db: IDBDatabase): Promise<StoredSnapshot | null> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD);
      request.onsuccess = () => resolve((request.result as StoredSnapshot | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeRecord(db: IDBDatabase, snapshot: StoredSnapshot | null): Promise<void> {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      if (snapshot) store.put(snapshot, RECORD);
      else store.delete(RECORD);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function bytesOf(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : text.length;
  } catch {
    // Blobs, cycles and anything else that cannot round-trip through IndexedDB.
    return null;
  }
}

/** The query hashes worth keeping: successful, serializable, and inside the size budget. */
function keepable(client: QueryClient): Set<string> {
  const kept = new Set<string>();
  let budget = MAX_TOTAL_BYTES;
  for (const query of client.getQueryCache().getAll()) {
    if (query.state.status !== "success" || query.state.data === undefined) continue;
    const bytes = bytesOf(query.state.data);
    if (bytes === null || bytes > MAX_ENTRY_BYTES || bytes > budget) continue;
    budget -= bytes;
    kept.add(query.queryHash);
  }
  return kept;
}

/** What a reload would restore: the successful, serializable part of the cache, within budget. */
export function persistedSnapshot(client: QueryClient): StoredSnapshot | null {
  const keep = keepable(client);
  if (keep.size === 0) return null;
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) => keep.has(query.queryHash),
  });
  return { version: CACHE_VERSION, userId: lastQueryUser(), savedAt: Date.now(), state };
}

/**
 * The part of a stored snapshot that is safe to restore: what this build understands, and what
 * no in-flight request is about to replace with something fresher.
 */
export function hydratableQueries(
  stored: Partial<DehydratedState>,
  client: QueryClient,
): DehydratedState["queries"] {
  return (stored.queries ?? []).filter(
    (query) => client.getQueryState(query.queryKey as QueryKey)?.fetchStatus !== "fetching",
  );
}

/** Whether a stored snapshot belongs to this browser's current user and build. */
export function snapshotApplies(stored: StoredSnapshot): boolean {
  return stored.version === CACHE_VERSION && stored.userId === lastQueryUser();
}

/**
 * Restores the last snapshot into the query client. Resolves whether or not anything was found,
 * and never holds up startup for longer than a quarter second.
 */
export async function hydrateQueryCache(client: QueryClient): Promise<void> {
  if (!indexedDb()) return;
  const restore = (async () => {
    const db = await openDatabase();
    if (!db) return;
    const stored = await readRecord(db);
    db.close();
    if (!stored || !snapshotApplies(stored)) return;
    const queries = hydratableQueries(stored.state, client);
    if (queries.length === 0) return;
    try {
      hydrate(client, { ...stored.state, queries });
    } catch {
      // A cache that cannot be read is a slow start, not a broken one.
    }
  })();
  await Promise.race([
    restore.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS)),
  ]);
}

/** Writes the cache back as it changes, debounced, and once more as the page goes away. */
export function startQueryCachePersistence(client: QueryClient): () => void {
  if (!indexedDb()) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let database: IDBDatabase | null = null;
  let writing = false;

  const save = () => {
    timer = undefined;
    if (writing) return;
    const snapshot = persistedSnapshot(client);
    writing = true;
    void (async () => {
      try {
        database ??= await openDatabase();
        if (database) await writeRecord(database, snapshot);
      } finally {
        writing = false;
      }
    })();
  };

  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe(schedule);
  const onHide = () => {
    if (timer !== undefined) clearTimeout(timer);
    save();
  };
  globalThis.addEventListener?.("pagehide", onHide);

  return () => {
    unsubscribe();
    globalThis.removeEventListener?.("pagehide", onHide);
    if (timer !== undefined) clearTimeout(timer);
    database?.close();
    database = null;
  };
}

/** Drops the snapshot, for a sign-out or an account switch. */
export async function clearPersistedQueryCache(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await writeRecord(db, null);
  db.close();
}