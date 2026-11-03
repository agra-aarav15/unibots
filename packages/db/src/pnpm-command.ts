import path from "node:path";

/**
 * How to spawn pnpm from Node.
 *
 * Windows cannot run pnpm's `.cmd` shim without a shell — `spawn("pnpm")` fails with `ENOENT` and
 * `spawn("pnpm.cmd")` with `EINVAL` — so prefer the JavaScript entry the invoking shell already
 * used, and fall back to a shell that can resolve the shim. On other platforms a bare `pnpm` works.
 *
 * The parameters exist so the choice can be tested without spawning anything.
 */
export function pnpmCommand(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  const entry = env.npm_execpath;
  if (entry && path.isAbsolute(entry) && /^pnpm\.(?:cjs|mjs|js)$/i.test(path.basename(entry))) {
    return { file: process.execPath, args: [entry, ...args] };
  }
  if (platform === "win32") {
    return { file: env.ComSpec ?? "cmd.exe", args: ["/c", "pnpm", ...args] };
  }
  return { file: "pnpm", args };
}
