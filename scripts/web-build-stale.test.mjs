import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  webBuildId,
  webBuildInputs,
  webBuildStale,
  workspacePackageDir,
  workspacePackageNames,
} from "./web-build-stale.mjs";

const OLDER = new Date("2026-11-08T12:00:00Z");
const BUILT = new Date("2026-11-09T12:00:00Z");
const NEWER = new Date("2026-11-10T12:00:00Z");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A checkout with a built web app and one shared package the bundle imports. */
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-build-stale-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, contents, mtime) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    utimesSync(file, mtime, mtime);
  };
  write(
    "apps/web/package.json",
    JSON.stringify({
      name: "@unibot/web",
      dependencies: { "@unibot/ui-web": "workspace:*", react: "19.0.0" },
    }),
    OLDER,
  );
  for (const input of [
    "src/App.tsx",
    "public/theme.js",
    "index.html",
    "vite.config.ts",
    "lingui.config.ts",
    "tsconfig.json",
  ]) {
    write(`apps/web/${input}`, "old", OLDER);
  }
  write("packages/ui-web/src/button.tsx", "old", OLDER);
  write("apps/web/dist/index.html", "<html></html>", BUILT);
  write("apps/web/dist/build-id", "202611091145\n", BUILT);
  return { root, write };
}

test("a build newer than every input is fresh", (t) => {
  const { root } = fixture(t);
  assert.equal(webBuildStale(root), false);
});

test("an edited page or a public asset makes the build stale", (t) => {
  const page = fixture(t);
  page.write("apps/web/src/App.tsx", "new", NEWER);
  assert.equal(webBuildStale(page.root), true);

  const asset = fixture(t);
  asset.write("apps/web/public/theme.js", "new", NEWER);
  assert.equal(webBuildStale(asset.root), true);
});

test("an edit inside a shared package the bundle imports makes the build stale", (t) => {
  const { root, write } = fixture(t);
  write("packages/ui-web/src/button.tsx", "new", NEWER);
  assert.equal(webBuildStale(root), true);
});

test("a missing build, or one with no build id, is stale", (t) => {
  const gone = fixture(t);
  rmSync(path.join(gone.root, "apps/web/dist/index.html"));
  assert.equal(webBuildStale(gone.root), true);

  const unlabelled = fixture(t);
  rmSync(path.join(unlabelled.root, "apps/web/dist/build-id"));
  assert.equal(webBuildStale(unlabelled.root), true);
});

test("reports the build id the build wrote", (t) => {
  const { root } = fixture(t);
  assert.equal(webBuildId(root), "202611091145");
  rmSync(path.join(root, "apps/web/dist/build-id"));
  assert.equal(webBuildId(root), undefined);
});

test("takes only workspace dependencies as inputs, not published packages", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(workspacePackageNames(path.join(root, "apps", "web")), ["@unibot/ui-web"]);
  assert.equal(
    workspacePackageDir(root, "@unibot/ui-web"),
    path.join(root, "packages", "ui-web"),
  );
  assert.equal(workspacePackageDir(root, "@unibot/absent"), undefined);
  assert.ok(
    webBuildInputs(root).includes(path.join(root, "packages", "ui-web")),
    "the shared package is an input",
  );
});

test("every workspace dependency of the real web app resolves to a directory", () => {
  for (const name of workspacePackageNames(path.join(repoRoot, "apps", "web"))) {
    assert.ok(
      workspacePackageDir(repoRoot, name),
      `${name} should resolve so its edits can invalidate the bundle`,
    );
  }
});