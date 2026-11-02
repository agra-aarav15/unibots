// `docker compose exec api node dist/cli/reset-password.js --email you@home`:
// local password recovery without email. The new password comes from
// RAKAZO_NEW_PASSWORD or stdin, never argv, so it stays out of shell history.
import { contentKeyProviderFromEnv } from "@rakazo/adapters";
import { createAuth } from "@rakazo/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@rakazo/core";
import {
  createDb,
  installSecurityEventStore,
  recordSecurityEvent,
  runAsSystem,
} from "@rakazo/db";
import { loadEnv } from "../env.js";

class ResetError extends Error {}

await main();

async function main() {
  try {
    const email = parseEmail(process.argv.slice(2));
    const password = process.env.RAKAZO_NEW_PASSWORD ?? (await readPassword());
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new ResetError(
        `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
      );
    }
    await reset(email, password);
  } catch (error) {
    if (!(error instanceof ResetError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

async function reset(email: string, password: string) {
  const env = loadEnv();
  const { prisma, pool } = createDb(env.databaseUrl, { keyProvider: contentKeyProviderFromEnv() });
  installSecurityEventStore(prisma);
  try {
    await runAsSystem("local password reset", async () => {
      const matches = await prisma.user.findMany({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, email: true },
        take: 2,
      });
      if (matches.length === 0) throw new ResetError("No account matches that email.");
      if (matches.length > 1) throw new ResetError("More than one account matches that email.");

      const user = matches[0]!;
      const auth = createAuth(prisma, {
        secret: env.authSecret,
        baseURL: env.authUrl,
        webOrigin: env.webOrigin,
        signupsEnabled: env.signupsEnabled,
        signupAllowlist: env.signupAllowlist,
        passwordAuth: env.passwordAuth,
      });
      const context = await auth.$context;
      const hash = await context.password.hash(password);
      await context.internalAdapter.updatePassword(user.id, hash);
      // A lost password also means a lost device, so every existing session ends.
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await recordSecurityEvent({
        type: "auth.password.changed",
        userId: user.id,
        metadata: { via: "local-cli" },
      });
      process.stdout.write(`Password reset for ${user.email}\n`);
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

function parseEmail(args: string[]): string {
  let value: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--email") {
      value = args[++index] ?? null;
      continue;
    }
    if (arg.startsWith("--email=")) {
      value = arg.slice("--email=".length);
      continue;
    }
    throw new ResetError(`Unknown argument: ${arg}`);
  }
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") throw new ResetError("Pass --email <address>.");
  return trimmed;
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) process.stderr.write("New password: ");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  // A terminal or `echo` adds one line ending; keep every other character.
  return input.replace(/\r?\n$/, "");
}