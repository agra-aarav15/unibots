import type { ComputerAction } from "@unibot/adapter-kit";

/** One frame of the real display, encoded the way a computer observation carries it. */
export interface NativeScreenFrame {
  image: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  cursor?: { x: number; y: number };
  activeWindow?: { id: string; title?: string };
}

/** Reads and drives the display this process runs on. Every method touches the real desktop. */
export interface NativeScreen {
  capture(): Promise<NativeScreenFrame>;
  perform(action: ComputerAction): Promise<void>;
  close(): void;
}

export const NATIVE_SCREEN_UNAVAILABLE =
  "This computer has no screen to control. Use commands to work with files and apps.";

/** Platforms where this build drives the display natively. */
export function nativeScreenSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

/**
 * Opens the display controller, or null when this machine has none to offer. The native bindings
 * load only when a screen is actually used, so nothing pays for them otherwise.
 */
export async function openNativeScreen(): Promise<NativeScreen | null> {
  if (!nativeScreenSupported()) return null;
  const { createWin32Screen } = await import("./native-screen-win32.js");
  return createWin32Screen();
}
