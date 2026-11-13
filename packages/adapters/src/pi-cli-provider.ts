import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Model, MutableModels, Provider } from "@earendil-works/pi-ai";
import type { CliModelCommand } from "@unibot/contracts";
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_TOKENS } from "@unibot/contracts";
import {
  CLI_MODEL_PLACEHOLDER,
  CLI_PROMPT_PLACEHOLDER,
  cliSpawnEnv,
  cliTemplateNeedsStdin,
  resolveCliProgram,
  splitCliTemplate,
  substituteCliTemplate,
} from "./cli-command.js";
import { customTransportProvider } from "./pi-custom-transport-provider.js";

/**
 * A model served by a command the user typed: CLIs that answer prompts but
 * expose no API to connect to. The command is spawned fresh for every turn with
 * the conversation's last message as its prompt, and its stdout is the answer.
 */

export const CLI_PROVIDER_ID = "local-cli";

/** Placeholder catalog model id; users name the real model when connecting. */
export const CLI_CATALOG_MODEL_ID = "cli";

export { CLI_MODEL_PLACEHOLDER, CLI_PROMPT_PLACEHOLDER };

/** A URL nothing connects to; the transport never reaches the network. */
const CLI_BASE_URL = "http://127.0.0.1:1/v1";

const CLI_STDERR_LIMIT = 4_096;
/** An agent CLI can think for minutes; only a wedged process hits this. */
export const CLI_DEFAULT_TIMEOUT_MS = 15 * 60_000;

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/** Terminal colour the CLI adds for a human at a prompt is not part of the answer. */
export function createAnsiStripper(): (chunk: string) => string {
  let held = "";
  return (chunk) => {
    const text = held + chunk;
    // A chunk can end inside an escape sequence; hold it back rather than print half of it.
    const tail = /\u001B\[[\d;]*$/.exec(text);
    held = tail ? tail[0] : "";
    const body = tail ? text.slice(0, tail.index) : text;
    return body.replace(ANSI_PATTERN, "");
  };
}

type CliMessage = { role?: string; content?: unknown; [key: string]: unknown };

type CliChatRequest = { model?: string; messages?: CliMessage[] };

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (typeof part !== "object" || part === null) return "";
  const record = part as { type?: unknown; text?: unknown };
  return record.type === "text" && typeof record.text === "string" ? record.text : "";
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(partText).filter(Boolean).join("\n");
  return "";
}

/**
 * One prompt from the whole transcript. A lone user turn is passed through
 * untouched — what a CLI expects — and a longer conversation becomes a labelled
 * transcript so the tool answers the last message in context.
 */
export function renderCliPrompt(messages: readonly CliMessage[]): string {
  const preamble: string[] = [];
  const turns: string[] = [];
  for (const message of messages) {
    const text = messageText(message.content).trim();
    if (!text) continue;
    if (message.role === "system" || message.role === "developer") {
      preamble.push(text);
    } else if (message.role === "tool") {
      turns.push(`Tool result: ${text}`);
    } else if (message.role === "user" || message.role === "assistant") {
      turns.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
    }
  }
  if (turns.length === 1) {
    turns[0] = turns[0]!.replace(/^User: /, "");
  } else if (turns.length > 1) {
    turns.unshift("Continue the conversation below. Reply with the assistant's next message only.");
  }
  return [...preamble, ...turns].filter(Boolean).join("\n\n");
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  const raw = init?.body;
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw));
  if (raw instanceof URLSearchParams) return raw.toString();
  if (input instanceof Request) return await input.text();
  throw new Error("Command connections only accept a JSON request body");
}

function errorResponse(message: string, status = 502): Response {
  return new Response(JSON.stringify({ error: { message, type: "cli_error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type CliProcess = ChildProcessByStdio<Writable, Readable, Readable>;

type StartedCli = {
  child: CliProcess;
  /** Output so far, plus the sink that takes over once streaming begins. */
  output: CliOutputPump;
  exit: Promise<{ code: number | null; stderr: string }>;
};

class CliOutputPump {
  private readonly chunks: string[] = [];
  private sink: ((text: string) => void) | undefined;
  private firstSettled = false;
  private firstResolve: ((produced: boolean) => void) | undefined;
  /** Whether the command produced output before it exited. */
  readonly first: Promise<boolean>;

  constructor() {
    this.first = new Promise((resolve) => {
      this.firstResolve = resolve;
    });
  }

  push(text: string): void {
    if (this.sink) this.sink(text);
    else this.chunks.push(text);
    this.settle(true);
  }

  settle(produced: boolean): void {
    if (this.firstSettled) return;
    this.firstSettled = true;
    this.firstResolve?.(produced);
  }

  /** Drains what arrived before the request was accepted, then follows live output. */
  follow(sink: (text: string) => void): void {
    const pending = this.chunks.splice(0, this.chunks.length);
    this.sink = sink;
    for (const chunk of pending) sink(chunk);
  }
}

function startCli(
  file: string,
  argv: string[],
  stdin: string | undefined,
  command: CliModelCommand,
): StartedCli {
  const child = spawn(file, argv, {
    cwd: command.cwd?.trim() || process.cwd(),
    env: cliSpawnEnv(process.env),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  }) as CliProcess;
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin ?? "");

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-CLI_STDERR_LIMIT);
  });

  const output = new CliOutputPump();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => output.push(chunk));

  const exit = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    };
    child.once("error", (error: Error) => {
      stderr = `${stderr}\n${error.message}`.trim().slice(-CLI_STDERR_LIMIT);
      done(-1);
    });
    child.once("close", (code) => done(code));
  });

  return { child, output, exit };
}

/**
 * A fetch that answers an OpenAI chat-completions request by running the
 * command. Everything above it — transcript building, streaming, cancellation —
 * is the same code path as a real OpenAI-compatible server.
 */
export function createCliFetch(command: CliModelCommand): typeof globalThis.fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init?.signal?.aborted) throw abortError();
    init?.signal?.addEventListener("abort", abort, { once: true });

    let body: CliChatRequest;
    try {
      body = JSON.parse(await requestBody(input, init)) as CliChatRequest;
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : "Unreadable request body", 400);
    }

    const tokens = splitCliTemplate(command.command);
    if (tokens.length === 0) return errorResponse("This connection has no command to run", 400);
    let program: { file: string; prefix: string[] };
    let argv: string[];
    let prompt: string;
    try {
      prompt = renderCliPrompt(body.messages ?? []);
      const substituted = substituteCliTemplate(tokens, {
        prompt,
        model: typeof body.model === "string" ? body.model : "",
      });
      program = resolveCliProgram(substituted[0]!);
      argv = [...program.prefix, ...substituted.slice(1)];
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Could not start the command",
        400,
      );
    }

    const model = typeof body.model === "string" ? body.model : "";
    const timeoutMs =
      command.timeoutMs && command.timeoutMs > 0 ? command.timeoutMs : CLI_DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const started = startCli(
      program.file,
      argv,
      cliTemplateNeedsStdin(tokens) ? prompt : undefined,
      command,
    );
    controller.signal.addEventListener("abort", () => started.child.kill(), { once: true });
    // Exiting without output settles the wait; output that already arrived wins.
    void started.exit.then(() => started.output.settle(false));

    try {
      const produced = await started.output.first;
      if (controller.signal.aborted) throw abortError();
      if (!produced) {
        const outcome = await started.exit;
        return outcome.code === 0
          ? emptyCompletion(model)
          : errorResponse(cliFailureMessage(outcome.stderr, outcome.code));
      }
      return new Response(streamCliCompletion(started, model), {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
      });
    } catch (error) {
      started.child.kill();
      if (timedOut) {
        return errorResponse(
          `The command did not answer within ${Math.round(timeoutMs / 1000)}s`,
          504,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function cliFailureMessage(stderr: string, code: number | null): string {
  const stripper = createAnsiStripper();
  const detail = stripper(stderr)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-3)
    .join(" ")
    .slice(0, 500);
  const status = code === null ? "was stopped" : `exited with code ${code}`;
  return detail ? `The command ${status}: ${detail}` : `The command ${status} without a message.`;
}

function envelope(model: string, choices: unknown[], usage?: Record<string, number>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-cli",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    ...(usage ? { usage } : {}),
  })}\n\n`;
}

function delta(model: string, content: string): string {
  return envelope(model, [{ index: 0, delta: { content }, finish_reason: null }]);
}

function emptyCompletion(model: string): Response {
  return new Response(
    [
      envelope(model, [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]),
      envelope(model, [{ index: 0, delta: {}, finish_reason: "stop" }], {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      }),
      "data: [DONE]\n\n",
    ].join(""),
    { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
  );
}

/** The command's stdout is the answer; its exit status ends the completion. */
function streamCliCompletion(started: StartedCli, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const stripper = createAnsiStripper();
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      const text = (raw: string) => {
        const cleaned = stripper(raw);
        if (cleaned) send(delta(model, cleaned));
      };
      send(envelope(model, [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]));
      started.output.follow(text);
      const outcome = await started.exit;
      if (finished) return;
      finished = true;
      // A non-zero exit after output still ends the turn; the text above is the answer.
      send(
        envelope(model, [
          { index: 0, delta: {}, finish_reason: outcome.code === 0 ? "stop" : "error" },
        ]),
      );
      send("data: [DONE]\n\n");
      controller.close();
    },
    cancel() {
      finished = true;
      started.child.kill();
    },
  });
}

function cliModel(id: string, command: CliModelCommand): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: CLI_PROVIDER_ID,
    baseUrl: CLI_BASE_URL,
    reasoning: false,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: command.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW,
    maxTokens: command.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
  };
}

function unconfiguredCliFetch(): typeof globalThis.fetch {
  return async () => errorResponse("Connect a command before using this model", 400);
}

function cliProvider(
  models: Model<"openai-completions">[],
  transportFor: (callerFetch?: typeof globalThis.fetch) => typeof globalThis.fetch,
): Provider {
  return customTransportProvider({
    id: CLI_PROVIDER_ID,
    name: "Command line",
    baseUrl: CLI_BASE_URL,
    models,
    // No network fetch is a meaningful seam here: the program is the transport.
    transportFor: () => transportFor(),
  });
}

/**
 * Always-visible catalog provider. The command is not known until a connection
 * exists, so the catalog entry says so rather than pretending to run something.
 * A registry that cannot take providers (a test double for the model catalog) is
 * left alone, the way the compatibility pass already tolerates one.
 */
export function registerCliCatalog(models: MutableModels): MutableModels {
  if (typeof models.setProvider !== "function") return models;
  models.setProvider(
    cliProvider(
      [{ ...cliModel(CLI_CATALOG_MODEL_ID, { command: "" }), name: "Command line model" }],
      unconfiguredCliFetch,
    ),
  );
  return models;
}

export function registerCliRuntime(
  models: MutableModels,
  command: CliModelCommand & { modelId: string },
): MutableModels {
  const transport = createCliFetch(command);
  models.setProvider(cliProvider([cliModel(command.modelId, command)], () => transport));
  return models;
}
