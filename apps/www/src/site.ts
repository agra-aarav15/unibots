export const SITE_NAME = "Unibots";

/**
 * Canonical origin for sitemap, canonical tags, and structured data.
 *
 * Set `PUBLIC_SITE_URL` to the domain you deploy this site on. The default keeps
 * local builds coherent and never points at a domain this project does not own.
 */
export const SITE_URL = (import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321").replace(
  /\/$/,
  "",
);

export const SITE_DESCRIPTION =
  "Unibots is an open source platform for persistent AI teammates that do real work. Your keys, your model, your machine.";

/** Plugin submissions are received by the project site; there is no hosted app to send them to. */
export const PLUGIN_SUBMISSIONS_URL = `${SITE_URL}/api/v1/plugin-submissions`;

/**
 * Optional integrations catalog. There is no bundled catalog: set `CATALOG_URL` in
 * the build environment to an HTTPS URL or a local file path to publish app pages.
 */
export const INTEGRATIONS_CATALOG_PATH = "/integrations/catalog.json";

export const GITHUB_URL = "https://github.com/agra-aarav15/unibots";
export const ANDROID_APK_URL =
  "https://github.com/agra-aarav15/unibots/releases/download/android/unibots.apk";
export const GITHUB_API_REPO = "https://api.github.com/repos/agra-aarav15/unibots";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;
export const DOCS_URL = "https://github.com/agra-aarav15/unibots/blob/main/docs/self-host.md";
export const SELF_HOST_SECRETS_URL =
  "https://github.com/agra-aarav15/unibots/blob/main/docs/self-host-secrets.md";
export const SELF_HOST_RESTRICTED_URL =
  "https://github.com/agra-aarav15/unibots/blob/main/docs/self-host-restricted-network.md";
export const SETUP_PROMPT_URL = "https://github.com/agra-aarav15/unibots/blob/main/SETUP_PROMPT.md";
export const SELF_HOST_GUIDE_PATH = "/self-hosted-ai-agent/";
export const OPENCLAW_ALTERNATIVE_PATH = "/openclaw-alternative/";
export const CHANGELOG_URL = "https://github.com/agra-aarav15/unibots/releases";
export const LATEST_RELEASE_URL = `${CHANGELOG_URL}/latest`;