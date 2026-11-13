import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberQueryUser } from "./last-user";
import {
  clearPersistedQueryCache,
  hydrateQueryCache,
  hydratableQueries,
  persistedSnapshot,
  snapshotApplies,
  startQueryCachePersistence,
} from "./query-persist";

/** The storage the remembered user lives in; the real one is the browser's. */
function stubStorage(): void {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  });
}

async function failedQuery(client: QueryClient, queryKey: string): Promise<void> {
  await expect(
    client.fetchQuery({
      queryKey: [queryKey],
      queryFn: () => Promise.reject(new Error("offline")),
      retry: false,
    }),
  ).rejects.toThrow("offline");
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what a reload keeps", () => {
  it("stores successful space data and leaves failed reads out", async () => {
    const client = new QueryClient();
    client.setQueryData(["user:a", "space:s", "bootstrap"], { bots: [{ id: "bot-1" }] });
    await failedQuery(client, "broken");

    const snapshot = persistedSnapshot(client);

    expect(snapshot?.state.queries.map((query) => query.queryKey)).toEqual([
      ["user:a", "space:s", "bootstrap"],
    ]);
  });

  it("refuses to store an entry too large to read back quickly", () => {
    const client = new QueryClient();
    client.setQueryData(["small"], { value: 1 });
    client.setQueryData(["huge"], { text: "x".repeat(600 * 1024) });

    const snapshot = persistedSnapshot(client);

    expect(snapshot?.state.queries.map((query) => query.queryKey)).toEqual([["small"]]);
  });

  it("keeps nothing when there is nothing successful to keep", async () => {
    const client = new QueryClient();
    await failedQuery(client, "broken");

    expect(persistedSnapshot(client)).toBeNull();
  });
});

describe("what a reload trusts", () => {
  it("restores a snapshot written for the same user", () => {
    rememberQueryUser("user-a");
    const client = new QueryClient();
    client.setQueryData(["user:user-a", "space:s", "bootstrap"], { bots: [] });
    const snapshot = persistedSnapshot(client);

    expect(snapshot).not.toBeNull();
    expect(snapshotApplies(snapshot!)).toBe(true);
  });

  it("drops a snapshot another account left behind", () => {
    rememberQueryUser("user-a");
    const client = new QueryClient();
    client.setQueryData(["user:user-a", "space:s", "bootstrap"], { bots: [] });
    const snapshot = persistedSnapshot(client)!;

    rememberQueryUser("user-b");

    expect(snapshotApplies(snapshot)).toBe(false);
  });

  it("does not overwrite a request that is already in flight", () => {
    const client = new QueryClient();
    const inFlight = client.getQueryCache().build(client, { queryKey: ["user:a", "fresh"] });
    inFlight.setState({ fetchStatus: "fetching" });
    client.setQueryData(["user:a", "settled"], { value: 1 });

    const restored = hydratableQueries(
      {
        queries: [
          { queryKey: ["user:a", "fresh"] },
          { queryKey: ["user:a", "settled"] },
        ] as never,
      },
      client,
    );

    expect(restored.map((query) => query.queryKey)).toEqual([["user:a", "settled"]]);
  });
});

describe("without IndexedDB", () => {
  it("starts cold instead of failing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const client = new QueryClient();

    await expect(hydrateQueryCache(client)).resolves.toBeUndefined();
    await expect(clearPersistedQueryCache()).resolves.toBeUndefined();
    expect(() => startQueryCachePersistence(client)).not.toThrow();
    expect(persistedSnapshot(client)).toBeNull();
  });
});