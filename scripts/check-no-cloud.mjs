#!/usr/bin/env node
// Fails when a hosted-service reference reappears in product, desktop or marketing files.
// Run directly (`node scripts/check-no-cloud.mjs`) or through the test that imports it.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Every string that would mean the removed hosted service is back. */
export const FORBIDDEN = [
  "Unibots Cloud",
  "UNIBOTS_CLOUD_URL",
  "app.unibots.example",
  "Rakazo Cloud",
  "RAKAZO_CLOUD_URL",
  "app.rakazo.com",
];

const SCAN_ROOTS = ["apps", "packages", "docs", "infra", "scripts"];
/** Root-level product and setup files that also ship to readers. */
const SCAN_FILES = [
  "README.md",
  "README.ja.md",
  "README.zh-CN.md",
  "SETUP_PROMPT.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ".env.example",
];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".git",
  "generated",
  "migrations",
]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|astro|yml|yaml|html|css|prisma|example)$/;
/** Changelogs, the plan itself, and this guard may name the old hosted service. */
const ALLOWED = new Set(["CHANGELOG.md", "OPENCODE_PLAN.md", "check-no-cloud.mjs"]);

/** Text files the guard reads; changelogs, the plan, and this guard are exempt. */
export function isScannedFile(file) {
  return TEXT.test(file) && !ALLOWED.has(path.basename(file));
}

/**
 * Tracked files are the ones that ship; walking the working tree would descend
 * into build output and be far slower for the same answer. A source tarball
 * without git still gets the filesystem walk below.
 */
function trackedFiles(root) {
  const output = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--", ...SCAN_ROOTS, ...SCAN_FILES],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return output.split("\0").filter(Boolean);
}

async function walk(dir, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full, files);
      continue;
    }
    if (TEXT.test(entry.name) && !ALLOWED.has(entry.name)) files.push(full);
  }
  return files;
}

async function scannedFiles(root) {
  try {
    return trackedFiles(root).filter(isScannedFile);
  } catch {
    const files = [];
    for (const scanRoot of SCAN_ROOTS) await walk(path.join(root, scanRoot), files);
    for (const scanFile of SCAN_FILES) {
      const full = path.join(root, scanFile);
      if (TEXT.test(scanFile) && !ALLOWED.has(path.basename(scanFile))) files.push(full);
    }
    return files;
  }
}

/**
 * Returns `path:line: hit` for every forbidden string, so a failure names the file.
 * The pure core takes its files and reader so a test can run it without touching disk.
 */
export async function scanForCloudReferences(files, readText) {
  const hits = [];
  for (const file of files) {
    const text = await readText(file).catch(() => "");
    if (!text) continue;
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const forbidden of FORBIDDEN) {
        if (line.includes(forbidden)) {
          hits.push(`${file}:${index + 1}: ${forbidden}`);
        }
      }
    }
  }
  return hits;
}

export async function findCloudReferences(root) {
  return scanForCloudReferences(await scannedFiles(root), (file) =>
    readFile(path.resolve(root, file), "utf8"),
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const hits = await findCloudReferences(root);
  if (hits.length > 0) {
    process.stderr.write(`Hosted-service references found:\n${hits.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("No hosted-service references.\n");
}
