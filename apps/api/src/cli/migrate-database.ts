// `pnpm db:migrate`: schema migrations, the job queue schema, then the runtime
// login. Everything here runs as the migration (owner) role; the API and worker
// then connect with DATABASE_URL and only get the runtime grants.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { migrateJobQueue } from "@rakazo/adapters";
import { loadRootEnv } from "@rakazo/core/node/load-root-env";
import {
  databaseUrls,
  deployMigrations,
  provisionRuntimeRole,
  RUNTIME_ROLE,
  SINGLE_DATABASE_URL_WARNING,
} from "@rakazo/db";

/**
 * The directory of a workspace package, found from its resolved entry point.
 *
 * This used to shell out to `pnpm --filter @rakazo/db exec pwd`, which cannot work on Windows: Node
 * cannot spawn pnpm's `.cmd` shim, and under Git Bash `pwd` answers in MSYS form (`/f/UNIBOTS/...`),
 * which Node then reads as `F:\f\UNIBOTS\...`.
 */
function packageDirOf(entry: string, name: string): string {
  for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (parsed.name === name) return dir;
    }
    if (dir === path.dirname(dir)) throw new Error(`Could not find the ${name} package above ${entry}`);
  }
}

loadRootEnv();
const urls = databaseUrls(process.env);
await deployMigrations({
  migrationUrl: urls.migrationUrl,
  dbPackageDir: packageDirOf(createRequire(import.meta.url).resolve("@rakazo/db"), "@rakazo/db"),
});
await migrateJobQueue(urls.migrationUrl);

if (!urls.separate) {
  process.stderr.write(`WARNING: ${SINGLE_DATABASE_URL_WARNING}\n`);
} else {
  const { warning } = await provisionRuntimeRole(urls.migrationUrl, urls.url);
  if (warning) process.stderr.write(`WARNING: ${warning}\n`);
  else process.stdout.write(`Runtime login is ready (member of ${RUNTIME_ROLE}).\n`);
}
