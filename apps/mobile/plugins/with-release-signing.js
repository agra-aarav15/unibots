// Release signing for local Gradle builds. EAS cloud builds keep using the project's
// managed keystore; this plugin only adds a release signingConfig when the keystore
// secrets are present, so a build without them stays debug-signed instead of failing.
//
// Secrets (never committed): ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
// ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
const fs = require("node:fs");
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_CONFIG = `
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
`;

/**
 * Point the release build type at the new signing config.
 *
 * Two traps in Expo's generated file: `signingConfigs` has its own `release` block, and
 * `buildTypes` lists `debug` before `release` with its own `signingConfig ... .debug` line.
 * So anchor on the `release {` that follows `buildTypes`, then replace only the first
 * signingConfig line after it. The debug build type must keep the debug key.
 */
function useReleaseSigning(contents) {
  const buildTypes = contents.indexOf("buildTypes {");
  if (buildTypes === -1) return contents;
  const tail = contents.slice(buildTypes);
  const release = tail.indexOf("release {");
  if (release === -1) return contents;
  return (
    contents.slice(0, buildTypes) +
    tail.slice(0, release) +
    tail
      .slice(release)
      .replace("signingConfig signingConfigs.debug", "signingConfig signingConfigs.release")
  );
}

/**
 * Expo's own template reads the keystore secrets unconditionally, and Gradle converts every
 * signing config while evaluating the project — so a machine without the release secrets fails
 * even a debug build with "Cannot convert 'null' to File". Guard the block so the path is only
 * read when it is set.
 */
const EXPO_UNGUARDED = `storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")`;

const GUARDED = `def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }`;

function guardReleaseKeystore(contents) {
  return contents.includes(EXPO_UNGUARDED)
    ? contents.replace(EXPO_UNGUARDED, GUARDED)
    : contents;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    cfg.modResults.contents = guardReleaseKeystore(cfg.modResults.contents);
    const storePath = process.env.ANDROID_KEYSTORE_PATH;
    if (!storePath || !fs.existsSync(storePath)) return cfg;
    if (!cfg.modResults.contents.includes("signingConfigs {")) return cfg;
    if (cfg.modResults.contents.includes("signingConfigs.release")) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /signingConfigs \{/,
      `signingConfigs {${SIGNING_CONFIG}`,
    );
    cfg.modResults.contents = useReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.useReleaseSigning = useReleaseSigning;
module.exports.guardReleaseKeystore = guardReleaseKeystore;
