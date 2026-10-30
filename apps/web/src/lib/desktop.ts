import type { UnibotsDesktop, UnibotsDesktopOAuthCallback } from "@unibots/contracts";

export type { UnibotsDesktop, UnibotsDesktopOAuthCallback } from "@unibots/contracts";

declare global {
  interface Window {
    unibotsDesktop?: UnibotsDesktop;
  }
}

export function desktopBridge(): UnibotsDesktop | undefined {
  return typeof window === "undefined" ? undefined : window.unibotsDesktop;
}

/** The compact `code#state` form the manual paste flow already accepts. */
export function desktopOAuthCode(callback: UnibotsDesktopOAuthCallback) {
  return callback.state === undefined ? callback.code : `${callback.code}#${callback.state}`;
}

/**
 * The authorize URL carries the attempt's PKCE state, so a captured code whose
 * state differs belongs to a different attempt — a popup left open by a
 * cancelled sign-in, say — and must not be spent on the current one.
 */
export function oauthStateOf(verificationUri: string): string | undefined {
  try {
    return new URL(verificationUri).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Desktop sign-in redirects to a loopback URL the renderer never sees, so the main process
 * captures the code there and the copy-and-paste step can be skipped. No-ops in a browser.
 * Providers whose authorize URL carries no state cannot be correlated, so their codes are
 * always accepted.
 */
export function onDesktopOAuthCallback(
  listener: (code: string) => void,
  expectedState?: string,
): () => void {
  const oauth = desktopBridge()?.oauth;
  if (!oauth) return () => undefined;
  return oauth.onCallback((callback) => {
    if (expectedState !== undefined && callback.state !== expectedState) return;
    listener(desktopOAuthCode(callback));
  });
}

export function windowChromeKind(desktop?: UnibotsDesktop): "spacer" | "darwin" | "controls" {
  if (!desktop) return "spacer";
  if (desktop.platform === "darwin") return "darwin";
  if (desktop.nativeWindowFrame) return "spacer";
  return "controls";
}
