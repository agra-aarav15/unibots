import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/**
 * The built web app ships beside the API, so one process can serve both the interface and the RPC
 * it calls; the desktop then needs no second server. A dev server, or an image built without the
 * web app, has no directory here and mounts nothing.
 */
export function webAppRoot(dist = new URL("../../web/dist/", import.meta.url)): string | undefined {
  const root = fileURLToPath(dist);
  return existsSync(root) ? root : undefined;
}

/**
 * Mounted after every route, so only a request no handler claimed reaches the files. Hashed assets
 * are immutable; the shell is revalidated so a new build is picked up on the next load. A browser
 * navigation that matched no file gets the shell, which is how client-side routes survive a reload.
 */
export function mountWebApp(app: Hono, root: string): void {
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.get("cache-control")) {
      c.header(
        "cache-control",
        c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    }
  });
  app.use("*", serveStatic({ root }));
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    // Only a navigation wants the shell; an RPC or asset request for a missing path stays a 404.
    if (!c.req.header("accept")?.includes("text/html")) return next();
    return serveStatic({ root, path: "index.html" })(c, next);
  });
}
