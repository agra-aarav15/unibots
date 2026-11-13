import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CLI_MODEL_PLACEHOLDER, CLI_PROMPT_PLACEHOLDER } from "@unibot/contracts";

/**
 * Running a user-typed command template. The template is the whole connection
 * setting: a program, its literal arguments, and `{{prompt}}` / `{{model}}`
 * placeholders. Nothing is shell-interpreted, so a prompt containing quotes,
 * backslashes or newlines reaches the program byte for byte.
 */

export { CLI_MODEL_PLACEHOLDER, CLI_PROMPT_PLACEHOLDER };

/** Splits a template into argv the way a shell would, minus expansion: quotes group, escapes drop. */
export function splitCliTemplate(template: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index]!;
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === "\\" && quote === '"' && template[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted token is still an argument: `--flag ""`.
      started = true;
      continue;
    }
    if (char === "\\" && template[index + 1] !== undefined) {
      current += template[index + 1]!;
      started = true;
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new Error("The command has an unclosed quote");
  if (started) tokens.push(current);
  return tokens;
}

const PLACEHOLDER_PATTERN = /\{\{prompt\}\}|\{\{model\}\}/g;

/** One pass, so a placeholder inside the substituted value is text, not a new placeholder. */
export function substituteCliTemplate(
  tokens: readonly string[],
  values: { prompt?: string; model?: string },
): string[] {
  return tokens.map((token) =>
    token.replace(PLACEHOLDER_PATTERN, (match) =>
      match === CLI_PROMPT_PLACEHOLDER ? (values.prompt ?? "") : (values.model ?? ""),
    ),
  );
}

export function cliTemplateNeedsStdin(tokens: readonly string[]): boolean {
  return !tokens.some((token) => token.includes(CLI_PROMPT_PLACEHOLDER));
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  const pathext = env.PATHEXT?.trim();
  if (!pathext) return [".com", ".exe", ".bat", ".cmd"];
  return pathext
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function existingFile(candidate: string): string | undefined {
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The entry for `name` in one PATH directory. On Windows the extension decides
 * it: npm also writes an extensionless POSIX script that cmd.exe cannot run, so
 * PATHEXT candidates are tried first and that script is never chosen.
 */
function findExecutableFile(
  directory: string,
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return existingFile(path.join(directory, name));
  const lower = name.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return existingFile(path.join(directory, name));
  }
  for (const extension of windowsExtensions(env)) {
    const found = existingFile(path.join(directory, `${name}${extension}`));
    if (found) return found;
  }
  return undefined;
}

/**
 * Resolves a command to argv without a shell. npm installs a Windows command as
 * a `.cmd` shim that cmd.exe must interpret, and cmd.exe cannot carry a quoted
 * or multi-line argument; the shim names a real program and its script, so read
 * it and run that instead. Anything unresolvable is refused rather than handed
 * to a shell that would corrupt the prompt.
 */
export function resolveCliProgram(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { file: string; prefix: string[] } {
  const name = command.trim();
  if (!name) throw new Error("A command is required");
  if (name.includes("/") || name.includes("\\")) {
    const resolved = resolvePathProgram(name, env, platform);
    if (!resolved) throw new Error(`Command not found: ${name}`);
    return resolved;
  }
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory.trim()) continue;
    const found = findExecutableFile(directory, name, env, platform);
    if (!found) continue;
    const resolved = resolvePathProgram(found, env, platform);
    if (resolved) return resolved;
  }
  throw new Error(`Command not found on PATH: ${name}`);
}

function resolvePathProgram(
  file: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): { file: string; prefix: string[] } | undefined {
  const absolute = path.resolve(file);
  if (!existingFile(absolute)) return undefined;
  const lower = absolute.toLowerCase();
  if (platform !== "win32" || lower.endsWith(".exe") || lower.endsWith(".com")) {
    return { file: absolute, prefix: [] };
  }
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const shim = parseWindowsShim(readFileSync(absolute, "utf8"), path.dirname(absolute));
    if (!shim) {
      throw new Error(
        `Cannot run ${path.basename(absolute)} directly. Point the command at the program's .exe instead.`,
      );
    }
    return shim;
  }
  // An extensionless file on Windows is a shell script from a POSIX install.
  throw new Error(`Cannot run ${path.basename(absolute)} on Windows. Use the program's .exe.`);
}

/** npm's `.cmd` wrapper: `... & "%_prog%" "%dp0%\node_modules\...\script.js" %*`. */
function parseWindowsShim(text: string, directory: string): { file: string; prefix: string[] } | undefined {
  const exec = text
    .split(/\r?\n/)
    .filter((line) => line.includes("%*"))
    .pop();
  if (!exec) return undefined;
  const tail = exec.split("&").pop() ?? "";
  const tokens = splitCliTemplate(tail.replace(/%dp0%/gi, directory));
  if (tokens.at(-1) === "%*") tokens.pop();
  const program = tokens.shift();
  if (!program) return undefined;
  if (/^%_prog%$/i.test(program)) return nodeScriptInvocation(tokens);
  if (program.toLowerCase().endsWith(".exe") && existingFile(program)) {
    return { file: program, prefix: tokens };
  }
  if (/^node(\.exe)?$/i.test(program)) return nodeScriptInvocation(tokens);
  return undefined;
}

function nodeScriptInvocation(tokens: string[]): { file: string; prefix: string[] } | undefined {
  const script = tokens[0];
  if (!script || !existingFile(script)) return undefined;
  return { file: process.execPath, prefix: tokens };
}

/** `node` running Electron still runs scripts when it is asked to be Node. */
export function cliSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return process.versions.electron ? { ...env, ELECTRON_RUN_AS_NODE: "1" } : env;
}
