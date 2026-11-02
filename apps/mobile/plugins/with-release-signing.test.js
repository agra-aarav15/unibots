import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import withReleaseSigning from "./with-release-signing.js";

const GRADLE = `android {
    signingConfigs {
        release {
            storeFile file('stale.jks')
        }
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}
`;

/** Runs the plugin mod the way expo does, returning the resulting gradle text. */
function runPlugin(contents) {
  const mod = { modRequest: {}, modResults: { language: "groovy", contents } };
  const config = withReleaseSigning({});
  config.mods.android.appBuildGradle(mod);
  return mod.modResults.contents;
}

describe("with-release-signing", () => {
  it("leaves the project alone without a keystore path", () => {
    delete process.env.ANDROID_KEYSTORE_PATH;
    expect(runPlugin(GRADLE)).toBe(GRADLE);
  });

  it("adds a release signing config and switches the release build type to it", () => {
    const dir = mkdtempSync(join(tmpdir(), "unibots-keystore-"));
    process.env.ANDROID_KEYSTORE_PATH = join(dir, "release.jks");
    writeFileSync(process.env.ANDROID_KEYSTORE_PATH, "not a real keystore");
    process.env.ANDROID_KEYSTORE_PASSWORD = "secret";
    process.env.ANDROID_KEY_ALIAS = "unibots";
    process.env.ANDROID_KEY_PASSWORD = "secret";
    try {
      const gradle = runPlugin(GRADLE);
      expect(gradle).toContain('storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))');
      // Only the release build type switches; the debug build type keeps the debug key.
      const buildTypes = gradle.slice(gradle.indexOf("buildTypes {"));
      const debugPart = buildTypes.slice(0, buildTypes.indexOf("release {"));
      const releasePart = buildTypes.slice(buildTypes.indexOf("release {"));
      expect(debugPart).toContain("signingConfig signingConfigs.debug");
      expect(releasePart).toContain("signingConfig signingConfigs.release");
      expect(releasePart).not.toContain("signingConfig signingConfigs.debug");
      // The debug config and everything else the template set stay untouched.
      expect(gradle).toContain("keyAlias 'androiddebugkey'");
      expect(gradle).toContain("minifyEnabled true");
    } finally {
      delete process.env.ANDROID_KEYSTORE_PATH;
      delete process.env.ANDROID_KEYSTORE_PASSWORD;
      delete process.env.ANDROID_KEY_ALIAS;
      delete process.env.ANDROID_KEY_PASSWORD;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("switches the build type when signingConfigs already contains release", () => {
    // Expo's real app/build.gradle has its own signingConfigs.release, so a file-wide
    // search for `release {` lands in the wrong block and the build type never changes.
    const template = `android {
    signingConfigs {
        release {
            storeFile file('stale.jks')
        }
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;
    const dir = mkdtempSync(join(tmpdir(), "unibots-keystore-"));
    process.env.ANDROID_KEYSTORE_PATH = join(dir, "release.jks");
    writeFileSync(process.env.ANDROID_KEYSTORE_PATH, "not a real keystore");
    process.env.ANDROID_KEYSTORE_PASSWORD = "secret";
    process.env.ANDROID_KEY_ALIAS = "unibots";
    process.env.ANDROID_KEY_PASSWORD = "secret";
    try {
      const gradle = runPlugin(template);
      const buildTypes = gradle.slice(gradle.indexOf("buildTypes {"));
      expect(buildTypes).toContain("signingConfig signingConfigs.release");
      expect(buildTypes).not.toContain("signingConfig signingConfigs.debug");
    } finally {
      delete process.env.ANDROID_KEYSTORE_PATH;
      delete process.env.ANDROID_KEYSTORE_PASSWORD;
      delete process.env.ANDROID_KEY_ALIAS;
      delete process.env.ANDROID_KEY_PASSWORD;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
