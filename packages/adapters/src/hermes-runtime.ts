import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentUsage,
} from "@unibots/adapter-kit";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ERROR_BODY = 800;

export type HermesProfile = {
  /** Hermes profile name. Omit or use "default" for the gateway's root profile. */
  name?: string;
  apiKey: string;
};

export type HermesProfileProvisioner = {
  ensure(botId: string, signal?: AbortSignal): Promise<HermesProfile>;
};

export type HermesAgentRuntimeOptions = {
  /** Gateway origin, for example http://127.0.0.1:8642. */
  baseUrl: string;
  /** API_SERVER_KEY for the default profile. Ignored when a provisioner resolves a profile. */
  apiKey?: string;
  /** Fixed profile name for single-profile deployments. */
  profile?: string;
  /** Hermes model alias or id. Omit to use the profile's configured model. */
  model?: string;
  /** Per-bot profile provisioning for multi-tenant deployments. */
  provisioner?: HermesProfileProvisioner;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

export type HermesProfileProvisionerOptions = {
  /** Base URL of the Unibots Hermes profile provisioner. */
  url: string;
  /** Shared secret used to authenticate profile creation. */
  secret: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

type HermesChatChunk = {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown> | null;
  error?: { message?: string; type?: string } | string;
  hermes?: Record<string, unknown>;
};

type HermesToolProgress = {
  tool?: unknown;
  label?: unknown;
  status?: unknown;
  toolCallId?: unknown;
};

type HermesStatus = {
  kind?: unknown;
  message?: unknown;
  text?: unknown;
  status?: unknown;
};

/**
 * Keeps every Unibots bot on its own Hermes profile. The profile is created on first use
 * by the sidecar provisioner, which writes the profile's API_SERVER_KEY and lets the
 * multiplexing gateway hot-serve it. Each profile therefore has its own MEMORY.md,
 * USER.md, SOUL.md, skills, sessions and state.db.
 */
export function createHermesProfileProvisioner(
  options: HermesProfileProvisionerOptions,
): HermesProfileProvisioner {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const cache = new Map<string, Promise<HermesProfile>>();

  async function create(botId: string, signal?: AbortSignal): Promise<HermesProfile> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await doFetch(`${base}/profiles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: hermesProfileNameForBot(botId) }),
      signal: combined,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(
        `Hermes profile provisioning failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const body = (await response.json()) as {
      profile?: unknown;
      name?: unknown;
      api_key?: unknown;
      apiKey?: unknown;
    };
    const name = typeof body.profile === "string" ? body.profile : body.name;
    const apiKey = typeof body.api_key === "string" ? body.api_key : body.apiKey;
    if (typeof name !== "string" || typeof apiKey !== "string" || !apiKey) {
      throw new Error("Hermes profile provisioning returned an invalid response.");
    }
    return { name, apiKey };
  }

  return {
    ensure(botId, signal) {
      const cached = cache.get(botId);
      if (cached) return cached;
      const pending = create(botId, signal).catch((error) => {
        cache.delete(botId);
        throw error;
      });
      cache.set(botId, pending);
      return pending;
    },
  };
}

/** Profile ids are lowercase on disk and must be safe in a URL path segment. */
export function hermesProfileNameForBot(botId: string): string {
  const safe = botId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `bot-${safe || "unknown"}`;
}

/** Build the runtime selected by `AGENT_RUNTIME=hermes` from environment variables. */
export function hermesAgentRuntimeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HermesAgentRuntime {
  const baseUrl = env.UNIBOTS_HERMES_URL?.trim();
  if (!baseUrl) {
    throw new Error("UNIBOTS_HERMES_URL is required when AGENT_RUNTIME=hermes.");
  }
  const provisionUrl = env.UNIBOTS_HERMES_PROVISION_URL?.trim();
  const provisionSecret = env.UNIBOTS_HERMES_PROVISION_SECRET?.trim();
  if (Boolean(provisionUrl) !== Boolean(provisionSecret)) {
    throw new Error(
      "UNIBOTS_HERMES_PROVISION_URL and UNIBOTS_HERMES_PROVISION_SECRET must be set together.",
    );
  }
  const apiKey = env.UNIBOTS_HERMES_API_KEY?.trim() || undefined;
  if (!provisionUrl && !apiKey) {
    throw new Error(
      "Set UNIBOTS_HERMES_PROVISION_URL and UNIBOTS_HERMES_PROVISION_SECRET for per-bot profiles, or UNIBOTS_HERMES_API_KEY for a single profile.",
    );
  }
  return new HermesAgentRuntime({
    baseUrl,
    apiKey,
    profile: env.UNIBOTS_HERMES_PROFILE?.trim() || undefined,
    model: env.UNIBOTS_HERMES_MODEL?.trim() || undefined,
    provisioner:
      provisionUrl && provisionSecret
        ? createHermesProfileProvisioner({ url: provisionUrl, secret: provisionSecret })
        : undefined,
  });
}

export class HermesAgentRuntime implements AgentRuntime {
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly running = new Map<string, AbortController>();
  private readonly profileCache = new Map<string, Promise<HermesProfile>>();

  constructor(private readonly options: HermesAgentRuntimeOptions) {
    if (!options.baseUrl.trim()) throw new Error("HermesAgentRuntime requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  describe() {
    return {
      id: "hermes",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        streaming: true,
        // Hermes owns its context window and compacts its own session history.
        // Telling Unibots it does not would spend an extra host model call per
        // long thread on a transcript Hermes never receives.
        compaction: true,
        // Hermes executes its own tools server-side; Unibots surfaces their progress.
        tools: true,
        scripted: false,
      },
    };
  }

  async abort(runId: string): Promise<void> {
    this.running.get(runId)?.abort(new Error("Hermes run aborted"));
    this.running.delete(runId);
  }

  async *run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    this.running.set(request.runId, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Hermes run timed out"));
    }, this.timeoutMs);
    const forwardAbort = () => controller.abort(context?.signal?.reason);
    if (context?.signal?.aborted) controller.abort(context.signal.reason);
    else context?.signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      const profile = await this.resolveProfile(request, controller.signal);
      const url = this.endpoint(profile.name);
      const headers: Record<string, string> = {
        authorization: `Bearer ${profile.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        // A retried request replays the same Hermes run instead of writing a
        // second user turn into the session.
        "idempotency-key": request.runId,
        // The thread is the conversation. Hermes reloads this transcript from its
        // session store; sending it a separate conversation key could adopt another
        // thread's live session, so the session id alone names this one.
        "x-hermes-session-id": hermesSessionId(request.threadId),
      };

      const systemPrompt = request.runtimeInstructions ?? request.instructions;
      const body: Record<string, unknown> = {
        stream: true,
        // Only the current turn goes over the wire. Hermes owns the transcript:
        // it reloads the session named by X-Hermes-Session-Id from state.db and
        // injects the profile's MEMORY.md, USER.md and skills itself. Resending
        // Unibots' history would duplicate every earlier turn in its prompt.
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          {
            role: "user",
            content: userContent(request),
          },
        ],
      };
      if (this.options.model) body.model = this.options.model;

      const response = await this.doFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw abortError(error, timedOut);
        throw error;
      });

      if (!response.ok) {
        const bodyText = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY);
        throw new Error(
          `Hermes request failed (${response.status})${bodyText ? `: ${redact(bodyText, profile.apiKey)}` : ""}`,
        );
      }
      if (!response.body) throw new Error("Hermes returned an empty response stream.");

      yield { type: "turn" };
      let fullText = "";
      let thinking = false;
      let finished = false;

      try {
        for await (const frame of sseFrames(response.body)) {
          if (frame.event === "hermes.tool.progress") {
            const progress = parseToolProgress(frame.data);
            if (progress) {
              // A tool call means the model stopped reasoning and acted.
              if (thinking) {
                thinking = false;
                yield { type: "thinking", active: false };
              }
              yield {
                type: "progress",
                activity: true,
                text:
                  progress.status === "completed"
                    ? `${progress.tool} finished`
                    : `${progress.label ?? progress.tool}`,
              };
            }
            continue;
          }
          if (frame.event === "hermes.status") {
            const status = parseStatus(frame.data);
            if (status) yield { type: "progress", activity: true, text: status };
            continue;
          }
          if (frame.event === "approval.request") {
            throw new Error(
              "Hermes is waiting for an approval that Unibots cannot forward yet. Configure the Hermes profile with a non-interactive approval mode or approve the action in the Hermes dashboard, then retry.",
            );
          }
          if (frame.data === "[DONE]") {
            finished = true;
            break;
          }

          const chunk = parseJson<HermesChatChunk>(frame.data);
          if (!chunk) continue;
          const bodyModel = typeof chunk.model === "string" ? chunk.model : null;
          const choice = chunk.choices?.[0];
          const reasoning = choice?.delta?.reasoning_content;
          if (reasoning) {
            if (!thinking) {
              thinking = true;
              yield { type: "thinking", active: true };
            }
          }
          const text = choice?.delta?.content;
          if (text) {
            if (thinking) {
              thinking = false;
              yield { type: "thinking", active: false };
            }
            fullText += text;
            yield { type: "text", text };
          }
          if (thinking && choice?.finish_reason) {
            thinking = false;
            yield { type: "thinking", active: false };
          }
          if (chunk.usage) {
            const usage = hermesUsage(chunk.usage, bodyModel ?? request.model.id);
            if (usage) {
              if (request.onUsage) await request.onUsage(usage);
              yield { ...usage, ...(request.onUsage ? { accounted: true } : {}) };
            }
          }
          const error = chunkError(chunk);
          if (error) throw new Error(`Hermes agent failed: ${redact(error, profile.apiKey)}`);
          if (choice?.finish_reason) finished = true;
        }

        if (thinking) yield { type: "thinking", active: false };
        if (controller.signal.aborted) throw abortError(controller.signal.reason, timedOut);
        if (!finished && !fullText) {
          throw new Error("Hermes closed the stream without a response.");
        }
        yield { type: "done", ...(fullText ? { text: fullText } : {}) };
      } catch (error) {
        if (controller.signal.aborted) throw abortError(error, timedOut);
        if (error instanceof Error) throw error;
        throw new Error(`Hermes stream failed: ${String(error)}`);
      }
    } finally {
      clearTimeout(timeout);
      // Cancel the response body when a consumer stops iterating early (an
      // approval we cannot forward, an accounting error): otherwise the HTTP
      // stream and its Hermes run stay open after Unibots has given up.
      controller.abort();
      context?.signal?.removeEventListener("abort", forwardAbort);
      this.running.delete(request.runId);
    }
  }

  private async resolveProfile(
    request: AgentRunRequest,
    signal: AbortSignal,
  ): Promise<HermesProfile> {
    if (this.options.provisioner) {
      const cached = this.profileCache.get(request.botId);
      if (cached) return cached;
      const pending = this.options.provisioner.ensure(request.botId, signal).catch((error) => {
        this.profileCache.delete(request.botId);
        throw error;
      });
      this.profileCache.set(request.botId, pending);
      return pending;
    }
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      throw new Error(
        "Hermes is not configured: set UNIBOTS_HERMES_API_KEY or UNIBOTS_HERMES_PROVISION_URL.",
      );
    }
    return {
      name: this.options.profile,
      apiKey,
    };
  }

  private endpoint(profileName: string | undefined): string {
    if (!profileName || profileName === "default") {
      return `${this.baseUrl}/v1/chat/completions`;
    }
    return `${this.baseUrl}/p/${encodeURIComponent(profileName)}/v1/chat/completions`;
  }
}

export function hermesSessionId(threadId: string): string {
  return `unibots-${threadId}`;
}

function userContent(request: AgentRunRequest): unknown {
  const images = request.currentTurnImages ?? [];
  if (images.length === 0) return request.prompt;
  return [
    { type: "text", text: request.prompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
      },
    })),
  ];
}

type SseFrame = { event?: string; data: string };

async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = nextBoundary(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const frame = parseFrame(block);
        if (frame) yield frame;
        boundary = nextBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const frame = parseFrame(buffer);
    if (frame) yield frame;
  } finally {
    reader.releaseLock();
  }
}

function nextBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || match.index === undefined) return null;
  return { index: match.index, length: match[0].length };
}

function parseFrame(block: string): SseFrame | null {
  if (!block.trim()) return null;
  let event: string | undefined;
  const data: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function parseToolProgress(data: string): {
  tool: string;
  label?: string;
  status?: string;
} | null {
  const parsed = parseJson<HermesToolProgress>(data);
  if (!parsed) return null;
  const tool = typeof parsed.tool === "string" ? parsed.tool : "tool";
  const label = typeof parsed.label === "string" ? parsed.label : undefined;
  const status = typeof parsed.status === "string" ? parsed.status : undefined;
  return { tool, label, status };
}

function parseStatus(data: string): string | null {
  const parsed = parseJson<HermesStatus>(data);
  if (!parsed) return null;
  if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text;
  if (typeof parsed.status === "string" && parsed.status.trim()) return parsed.status;
  if (typeof parsed.kind === "string" && parsed.kind.trim()) return parsed.kind;
  return null;
}

function chunkError(chunk: HermesChatChunk): string | null {
  if (!chunk.error) return null;
  if (typeof chunk.error === "string") return chunk.error;
  return chunk.error.message ?? chunk.error.type ?? "Hermes reported an error.";
}

function hermesUsage(
  raw: Record<string, unknown>,
  model: string,
): Extract<AgentRuntimeEvent, { type: "usage" }> | null {
  const input = number(raw.prompt_tokens ?? raw.input_tokens);
  const output = number(raw.completion_tokens ?? raw.output_tokens);
  const total =
    number(raw.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  if (input === null && output === null && total === null) return null;
  const usage: AgentUsage = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
  };
  return {
    type: "usage",
    provider: "hermes",
    model,
    ...usage,
  };
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function abortError(error: unknown, timedOut: boolean): Error {
  if (timedOut) return new Error("Hermes run timed out.");
  if (error instanceof Error && error.message === "Hermes run aborted") return error;
  return new Error("Hermes run aborted.");
}

function redact(value: string, secret: string): string {
  let next = value.replaceAll(secret, "[redacted]");
  next = next.replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return next;
}
