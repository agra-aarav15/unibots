import { describe, expect, it } from "vitest";

/** Loaded by path so the guard stays a plain script that also runs standalone in CI. */
const guard = "../../../scripts/check-no-cloud.mjs";

interface CloudGuard {
  scanForCloudReferences: (
    files: string[],
    readText: (file: string) => Promise<string>,
  ) => Promise<string[]>;
  isScannedFile: (file: string) => boolean;
}

/** The script is plain JavaScript, so its exports get one local contract here. */
async function cloudGuard(): Promise<CloudGuard> {
  return (await import(guard)) as CloudGuard;
}

describe("no hosted service", () => {
  it("flags a hosted-service reference with its file and line", async () => {
    const { scanForCloudReferences } = await cloudGuard();
    const files: Record<string, string> = {
      "apps/desktop/src/setup.js": 'const url = "https://app.rakazo.com";\n',
      "apps/www/src/site.ts": 'export const NAME = "Unibots Cloud";\n',
    };
    const hits = await scanForCloudReferences(Object.keys(files), async (file) => files[file]!);
    expect(hits).toEqual([
      "apps/desktop/src/setup.js:1: app.rakazo.com",
      "apps/www/src/site.ts:1: Unibots Cloud",
    ]);
  });

  it("passes self-hosted copy and ignores files it cannot read", async () => {
    const { scanForCloudReferences } = await cloudGuard();
    const files: Record<string, string> = {
      "apps/www/src/site.ts": 'export const GUIDE = "/self-host";\n',
    };
    const hits = await scanForCloudReferences(
      ["apps/www/src/site.ts", "docs/missing.md"],
      async (file) => files[file] ?? Promise.reject(new Error("ENOENT")),
    );
    expect(hits).toEqual([]);
  });

  it("scans product, desktop and marketing text but not changelogs or this guard", async () => {
    const { isScannedFile } = await cloudGuard();
    expect(isScannedFile("apps/www/src/site.ts")).toBe(true);
    expect(isScannedFile("apps/desktop/src/main.ts")).toBe(true);
    expect(isScannedFile("docs/desktop-app.md")).toBe(true);
    expect(isScannedFile("CHANGELOG.md")).toBe(false);
    expect(isScannedFile("OPENCODE_PLAN.md")).toBe(false);
    expect(isScannedFile("scripts/check-no-cloud.mjs")).toBe(false);
    expect(isScannedFile("docs/media/hero.png")).toBe(false);
  });
});
