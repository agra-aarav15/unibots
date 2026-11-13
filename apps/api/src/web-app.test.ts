import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountWebApp, webAppRoot } from "./web-app.js";

/** A built web app on disk, in the shape the bundler emits: hashed assets beside a shell. */
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "unibot-web-"));
  mkdirSync(path.join(root, "assets"));
  writeFileSync(path.join(root, "index.html"), "<!doctype html><title>UniBot</title>");
  writeFileSync(path.join(root, "assets", "app-abc123.js"), "console.log('app')");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function appWithWeb(): Hono {
  const app = new Hono();
  app.post("/rpc/ping", (c) => c.json({ json: "pong" }, 200, { "cache-control": "no-store" }));
  mountWebApp(app, root);
  return app;
}

const navigate = { headers: { accept: "text/html,application/xhtml+xml" } };

describe("mountWebApp", () => {
  it("serves a hashed asset immutably", async () => {
    const res = await appWithWeb().request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('app')");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves the shell at the root and on a client route, revalidating it", async () => {
    for (const url of ["/", "/app/boards/123"]) {
      const res = await appWithWeb().request(url, navigate);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>UniBot</title>");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("leaves an unclaimed API path to the API's own answer", async () => {
    for (const headers of [{ accept: "application/json" }, { accept: "*/*" }]) {
      const res = await appWithWeb().request("/rpc/missing", { headers });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("<title>");
    }
  });

  it("does not touch a reply a route already produced", async () => {
    const res = await appWithWeb().request("/rpc/ping", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not fall back to the shell for a mutation", async () => {
    const res = await appWithWeb().request("/app/boards", { method: "POST", ...navigate });
    expect(res.status).toBe(404);
  });
});

describe("webAppRoot", () => {
  it("reports the directory when a build is present", () => {
    expect(webAppRoot(pathToFileURL(root))).toBe(root);
  });

  it("mounts nothing when the build is absent", () => {
    expect(webAppRoot(pathToFileURL(path.join(root, "missing")))).toBeUndefined();
  });
});
