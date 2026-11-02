import { describe, expect, it } from "vitest";
import { associatedPasskeyRpIds } from "./passkeys.js";

describe("associatedPasskeyRpIds", () => {
  const resourcesPath = "/Applications/Rakazo.app/Contents/Resources";

  it("lists no associated domain after the hosted service was removed", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      for (const packaged of [true, false]) {
        expect(
          associatedPasskeyRpIds({
            platform,
            packaged,
            resourcesPath,
            exists: () => true,
          }),
          `${platform} packaged=${packaged}`,
        ).toEqual([]);
      }
    }
  });
});
