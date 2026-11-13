import type { Socket } from "node:net";
import { loadRootEnv } from "@unibot/core/node/load-root-env";

loadRootEnv();

import { serve } from "@hono/node-server";
import { SERVICE_NAMES } from "@unibot/logging";
import { createRootLogger } from "@unibot/logging/axiom";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { mountWebApp, webAppRoot } from "./web-app.js";

const logger = createRootLogger(SERVICE_NAMES.api);

try {
  const env = loadEnv();
  const { app, stop, handleUpgrade } = await createApp({ ...env, logger });
  // Same process, same origin: the desktop reaches the interface and its RPC at one address.
  const webRoot = webAppRoot();
  if (webRoot) mountWebApp(app, webRoot);
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.apiHost }, () => {
    logger.info("api listening", { "http.host": env.apiHost, "http.port": env.port });
  });
  // Desktop apps hold an outbound socket so bots can reach the user's own computer.
  if (handleUpgrade) server.on("upgrade", handleUpgrade);

  // SSE streams never end on their own, so server.close() alone would wait forever;
  // force-close sockets still open after a short grace period.
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const grace = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, 2_000);
    await closed;
    clearTimeout(grace);
    await stop();
    await logger.flush({ timeoutMs: 2_000 });
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
} catch (error) {
  logger.error("api startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
}
