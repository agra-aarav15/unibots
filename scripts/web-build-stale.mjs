// Whether the built web app predates anything that goes into it, so `pnpm app` builds only when it
// has to.
//
// This lives on its own because `scripts/dev.mjs` starts Postgres as soon as it is imported, so a
// test cannot load the check from there. It also has to look wider than `apps/web`: the bundle is
// built from the shared packages as well, and checking only `apps/web` meant an edit to a shared
// component never triggered a rebuild, so the app kept serving the old interface.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Files and directories inside `apps/web` that the build reads. */
const WEB_INPUTS = [
  "src",
  "public",
  "index.html",
  "vite.config.ts",
  "lingui.config.ts",
  "tsconfig.json",
  "package.json",
];

/** Workspace directories that can hold a package, in the order they are checked. */
const WORKSPACE_GROUPS = ["packages", "apps", "infra"];

/**
 * The workspace packages the web bundle imports, read from the app's own dependencies so a package
 * added later cannot be forgotten here.
 */
export function workspacePackageNames(webDir) {
  const manifest = JSON.parse(readFileSync(path.join(webDir, "package.json"), "utf8"));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  return Object.entries(dependencies)
    .filter(([, version]) => String(version).startsWith("workspace:"))
    .map(([name]) => name);
}

/** Where a workspace dependency lives, such as `@unibot/ui-web` in `packages/ui-web`. */
export function workspacePackageDir(root, name) {
  const slash = name.indexOf("/");
  const bare = slash === -1 ? name : name.slice(slash + 1);
  for (const group of WORKSPACE_GROUPS) {
    const candidate = path.join(root, group, bare);
    if (statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) return candidate;
  }
  return undefined;
}

/** Everything the built bundle is made from. */
export function webBuildInputs(root) {
  const webDir = path.join(root, "apps", "web");
  const inputs = WEB_INPUTS.map((entry) => path.join(webDir, entry));
  for (const name of workspacePackageNames(webDir)) {
    const dir = workspacePackageDir(root, name);
    if (dir) inputs.push(dir);
  }
  return inputs;
}

/** The identifier the build wrote, or nothing when the directory was not produced by a build. */
export function webBuildId(root) {
  try {
    return readFileSync(path.join(root, "apps", "web", "dist", "build-id"), "utf8").trim();
  } catch {
    return undefined;
  }
}

function newestIn(target) {
  const stats = statSync(target, { throwIfNoEntry: false });
  if (!stats) return 0;
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = path.join(target, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestIn(child) : (statSync(child, { throwIfNoEntry: false })?.mtimeMs ?? 0),
    );
  }
  return newest;
}

/**
 * True when the app has to be built again: no build is present, it carries no build id, or any input
 * is newer than it.
 */
export function webBuildStale(root) {
  const built = statSync(path.join(root, "apps", "web", "dist", "index.html"), {
    throwIfNoEntry: false,
  })?.mtimeMs;
  if (!built) return true;
  if (!webBuildId(root)) return true;
  return webBuildInputs(root).some((target) => newestIn(target) > built);
}