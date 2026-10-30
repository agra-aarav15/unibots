import type { RealtimeFanout, SecretStore } from "@unibots/adapter-kit";
import { createSecretStore } from "@unibots/adapters";
import { resolveEncryptionKey } from "@unibots/core";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
