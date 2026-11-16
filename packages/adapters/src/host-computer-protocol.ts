import type { ComputerObservation } from "@unibot/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@unibot/core";
import { z } from "zod";

export const HOST_COMPUTER_MAX_BYTES = 12 * 1024 * 1024;
export const HOST_COMPUTER_MAX_FILE_BYTES = 8 * 1024 * 1024;
const file = z.object({
  path: z.string().max(4096),
  content: z.string().max(HOST_COMPUTER_MAX_BYTES),
  executable: z.boolean().optional(),
});
const command = z.object({
  argv: z
    .array(z.string().max(1024 * 1024))
    .min(1)
    .max(1024),
  cwd: z.string().max(4096).optional(),
  env: z.record(z.string(), z.string()).optional(),
  unsetEnv: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
const directories = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ensure"), paths: z.array(z.string().max(4096)).max(256) }),
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("remove"),
    parent: z.enum(["bots", ".browser-profiles"]),
    names: z.array(z.string().max(256)).max(256),
  }),
]);
const base = { botId: z.string().min(1).max(256), runId: z.string().min(1).max(256).optional() };
/** One on-screen action, in the same shapes every computer tool already sends. */
export const hostComputerAction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pointer"),
    x: z.number(),
    y: z.number(),
    type: z.enum(["move", "down", "up", "click"]),
    button: z.enum(["left", "right"]).optional(),
  }),
  z.object({
    kind: z.literal("key"),
    key: z.string().max(64),
    modifiers: z.array(z.string().max(32)).max(8).optional(),
  }),
  z.object({ kind: z.literal("clipboard"), text: z.string().max(100_000) }),
  z.object({
    kind: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({ kind: z.literal("wait"), ms: z.number() }),
  z.object({ kind: z.literal("open"), path: z.string().max(4096) }),
  z.object({
    kind: z.literal("launch"),
    application: z.string().max(1024),
    uri: z.string().max(4096).optional(),
  }),
  z.object({
    kind: z.literal("focus"),
    application: z.string().max(1024),
    uri: z.string().max(4096).optional(),
  }),
]);
export const hostComputerRequest = z.discriminatedUnion("method", [
  z.object({
    ...base,
    method: z.enum([
      "provision",
      "prepare",
      "isRunning",
      "exportWorkspace",
      "snapshot",
      "stop",
      "destroy",
      "environment",
    ]),
  }),
  z.object({ ...base, method: z.literal("execute"), command }),
  z.object({ ...base, method: z.literal("workspaceDirectories"), directories }),
  z.object({
    ...base,
    method: z.literal("cancelRunWork"),
    targetRunId: z.string().min(1).max(256),
  }),
  z.object({ ...base, method: z.literal("listFiles"), path: z.string().max(4096) }),
  z.object({
    ...base,
    method: z.literal("readFile"),
    path: z.string().max(4096),
    maxBytes: z.number().int().positive().max(HOST_COMPUTER_MAX_FILE_BYTES).optional(),
  }),
  z.object({ ...base, method: z.literal("writeFile"), file }),
  z.object({ ...base, method: z.literal("observe") }),
  z.object({
    ...base,
    method: z.literal("act"),
    actions: z.array(hostComputerAction).min(1).max(24),
    observe: z.boolean().optional(),
    settleMs: z.number().int().min(0).max(5_000).optional(),
  }),
]);
export type HostComputerRequest = z.infer<typeof hostComputerRequest>;
export type HostComputerAction = z.infer<typeof hostComputerAction>;
/** A screen frame as it crosses the transport: the image is base64, never raw bytes. */
export type HostComputerObservation = Omit<ComputerObservation, "image"> & { image: string };
export interface HostComputerEnvironment {
  platform: string;
  home: string;
  shell: string;
}
export type HostComputerFrame<T> =
  | { value: T }
  | { done: true }
  | { error: string }
  | { heartbeat: true };

/** Leave time for the command timeout event and final response to cross the bridge. */
export function hostComputerDeadlineMs(request: HostComputerRequest) {
  return request.method === "execute"
    ? boundedSandboxCommandTimeoutMs(request.command.timeoutMs) + 30_000
    : 10 * 60_000;
}
