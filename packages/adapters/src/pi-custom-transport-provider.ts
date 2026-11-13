import type { Model, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

/**
 * A chat provider that speaks the OpenAI wire protocol but reaches its model
 * through a transport the caller supplies: a guarded HTTP fetch for a compatible
 * server, or a local program for a command connection. Everything above the
 * transport — streaming, cancellation, tool-call framing — is shared, so both
 * connections behave identically.
 */
export function customTransportProvider(options: {
  id: string;
  name: string;
  baseUrl: string;
  models: Model<"openai-completions" | "openai-responses">[];
  /** Builds the transport for one call; the runtime's own fetch seam wins when set. */
  transportFor: (callerFetch?: typeof globalThis.fetch) => typeof globalThis.fetch;
}): Provider {
  const api = (protocol: string) =>
    protocol === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi();
  const streams: ProviderStreams = {
    stream: (model, context, streamOptions) =>
      api(model.api).stream(model, context, {
        ...streamOptions,
        fetch: options.transportFor(streamOptions?.fetch),
      }),
    streamSimple: (model, context, streamOptions) =>
      api(model.api).streamSimple(model, context, {
        ...streamOptions,
        fetch: options.transportFor(streamOptions?.fetch),
      }),
  };
  return createProvider({
    id: options.id,
    name: options.name,
    baseUrl: options.baseUrl,
    auth: {
      apiKey: {
        name: options.name,
        // The transport authenticates; Models hides a provider with no resolvable auth.
        resolve: async () => ({ auth: { apiKey: "local" }, source: options.name }),
      },
    },
    models: options.models,
    api: streams,
  });
}
