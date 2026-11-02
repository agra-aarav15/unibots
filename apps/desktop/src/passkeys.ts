/**
 * Relying parties whose passkeys this build can use through the macOS system passkey sheet.
 * That sheet needs an associated domain; with no hosted domain there is none. Browser
 * passkeys on Windows and Linux, and passkeys on a VPS, are unaffected.
 */
export function associatedPasskeyRpIds(_input: {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
  exists: (file: string) => boolean;
}): string[] {
  return [];
}
