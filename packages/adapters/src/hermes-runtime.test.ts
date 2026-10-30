import type { AgentRunRequest } from "@unibots/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  createHermesProfileProvisioner,
  HermesAgentRuntime,
  hermesAgentRuntimeFromEnv,
  hermesProfileNameForBot,
  hermesSessionId,
} from "./hermes-runtime.js";
import { runtimeFallbackModel } from "./run-model.js";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    botId: "bot-1",
    threadId: "thread-1",
    runId: "run-1",
    prompt: "Finish the report",
    instructions: "Host tool guidance that Hermes should not receive.",
    runtimeInstructions: "You are Atlas, a careful research bot.",
    history: [],
    tools: [],
    model: { provider: "openrouter", id: "hermes-4" },
    ...overrides,
  };
}

function sse(frames: string, init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frames));
        controller.close();
      },
    }),
    {
      ...init,
      headers: { "content-type": "text/event-stream", ...(init.headers ?? {}) },
    },
  );
}

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("HermesAgentRuntime", () => {
  it("streams text, reasoning, tool activity and usage with Hermes session headers", async () => {
    const onUsage = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      sse(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"Plan first."}}]}',
          "",
          "event: hermes.tool.progress",
          'data: {"tool":"shell","label":"Running the test suite","status":"running"}',
          "",
          'data: {"choices":[{"delta":{"content":"All green."}}]}',
          "",
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      ),
    );
    const runtime = new HermesAgentRuntime({
      baseUrl: "http://hermes:8642/",
      apiKey: "gateway-key",
      model: "hermes-4",
      fetch: fetchMock as typeof fetch,
    });

    const events = await collect(
      runtime.run(request({ onUsage }), { userId: "user-1", signal: undefined }),
    );

    expect(events).toEqual([
      { type: "turn" },
      { type: "thinking", active: true },
      { type: "thinking", active: false },
      { type: "progress", activity: true, text: "Running the test suite" },
      { type: "text", text: "All green." },
      {
        type: "usage",
        provider: "hermes",
        model: "hermes-4",
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
        accounted: true,
      },
      { type: "done", text: "All green." },
    ]);
    expect(onUsage).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://hermes:8642/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer gateway-key");
    expect(headers.get("idempotency-key")).toBe("run-1");
    expect(headers.get("x-hermes-session-id")).toBe(hermesSessionId("thread-1"));
    expect(headers.get("x-hermes-session-key")).toBeNull();
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      stream: true,
      model: "hermes-4",
    });
    expect(body.messages).toEqual([
      { role: "system", content: "You are Atlas, a careful research bot." },
      { role: "user", content: "Finish the report" },
    ]);
    expect(body.tools).toBeUndefined();
  });

  it("routes a provisioned bot to its own Hermes profile", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      sse(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const ensure = vi.fn(async () => ({ name: "bot-bot-1", apiKey: "profile-key" }));
    const runtime = new HermesAgentRuntime({
      baseUrl: "http://hermes:8642",
      provisioner: { ensure },
      fetch: fetchMock as typeof fetch,
    });

    const events = await collect(runtime.run(request(), { userId: "user-1" }));

    expect(events.at(-1)).toEqual({ type: "done", text: "ok" });
    expect(ensure).toHaveBeenCalledWith("bot-1", expect.any(AbortSignal));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://hermes:8642/p/bot-bot-1/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer profile-key");
  });

  it("sends current turn images as OpenAI image parts", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      sse(
        'data: {"choices":[{"delta":{"content":"seen"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const runtime = new HermesAgentRuntime({
      baseUrl: "http://hermes:8642",
      apiKey: "gateway-key",
      fetch: fetchMock as typeof fetch,
    });

    await collect(
      runtime.run(
        request({
          currentTurnImages: [
            { name: "shot.png", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          ],
        }),
      ),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "Finish the report" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
  });

  it("fails with a redacted error on a gateway error", async () => {
    const runtime = new HermesAgentRuntime({
      baseUrl: "http://hermes:8642",
      apiKey: "gateway-key",
      fetch: vi.fn(
        async () =>
          new Response('{"error":{"message":"bad key sk-supersecretvalue"}}', { status: 502 }),
      ) as typeof fetch,
    });

    await expect(collect(runtime.run(request()))).rejects.toThrow("Hermes request failed (502)");
    const error = await collect(runtime.run(request())).catch((value: unknown) => value);
    expect(String(error)).not.toContain("supersecretvalue");
  });

  it("rejects an approval request it cannot forward yet", async () => {
    const runtime = new HermesAgentRuntime({
      baseUrl: "http://hermes:8642",
      apiKey: "gateway-key",
      fetch: vi.fn(async () =>
        sse('event: approval.request\ndata: {"title":"Delete the repo"}\n\n'),
      ) as typeof fetch,
    });

    await expect(collect(runtime.run(request()))).rejects.toThrow(
      "Hermes is waiting for an approval",
    );
  });

  it("validates gateway, profile and key configuration", () => {
    expect(() => hermesAgentRuntimeFromEnv({})).toThrow("UNIBOTS_HERMES_URL");
    expect(() => hermesAgentRuntimeFromEnv({ UNIBOTS_HERMES_URL: "http://hermes:8642" })).toThrow(
      "UNIBOTS_HERMES_PROVISION_URL",
    );
    expect(() =>
      hermesAgentRuntimeFromEnv({
        UNIBOTS_HERMES_URL: "http://hermes:8642",
        UNIBOTS_HERMES_PROVISION_URL: "http://provisioner:8650",
      }),
    ).toThrow("must be set together");
    expect(
      hermesAgentRuntimeFromEnv({
        UNIBOTS_HERMES_URL: "http://hermes:8642",
        UNIBOTS_HERMES_API_KEY: "gateway-key",
      }),
    ).toBeInstanceOf(HermesAgentRuntime);
  });

  it("normalizes bot ids into safe Hermes profile names", () => {
    expect(hermesProfileNameForBot("AbC_123")).toBe("bot-abc-123");
    expect(hermesProfileNameForBot("---")).toBe("bot-unknown");
  });

  it("falls back to the Hermes model when no Unibots connection is configured", () => {
    const runtime = new HermesAgentRuntime({ baseUrl: "http://hermes:8642", apiKey: "key" });
    expect(runtimeFallbackModel(runtime)).toEqual({ provider: "hermes", id: "hermes" });
  });
});

describe("createHermesProfileProvisioner", () => {
  it("creates a profile once and caches the credential", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ profile: "bot-bot-1", api_key: "derived-key" }),
    );
    const provisioner = createHermesProfileProvisioner({
      url: "http://provisioner:8650/",
      secret: "admin-secret",
      fetch: fetchMock as typeof fetch,
    });

    await expect(provisioner.ensure("bot-1")).resolves.toEqual({
      name: "bot-bot-1",
      apiKey: "derived-key",
    });
    await expect(provisioner.ensure("bot-1")).resolves.toEqual({
      name: "bot-bot-1",
      apiKey: "derived-key",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://provisioner:8650/profiles");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer admin-secret");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "bot-bot-1" });
  });

  it("does not cache a failed profile creation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(Response.json({ profile: "bot-bot-1", api_key: "key" }));
    const provisioner = createHermesProfileProvisioner({
      url: "http://provisioner:8650",
      secret: "admin-secret",
      fetch: fetchMock as typeof fetch,
    });

    await expect(provisioner.ensure("bot-1")).rejects.toThrow("profile provisioning failed");
    await expect(provisioner.ensure("bot-1")).resolves.toEqual({
      name: "bot-bot-1",
      apiKey: "key",
    });
  });
});
