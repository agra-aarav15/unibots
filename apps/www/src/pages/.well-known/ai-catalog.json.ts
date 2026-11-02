import type { APIRoute } from "astro";
import { SITE_NAME, SITE_URL } from "../../site";

/**
 * Agent resource catalog for this deployment.
 *
 * The entries point at this site's own generated resources, so the file is produced at
 * build time from `PUBLIC_SITE_URL` instead of naming a domain in a checked-in file.
 */
export const GET: APIRoute = () => {
  const catalog = {
    specVersion: "1.0",
    host: {
      displayName: SITE_NAME,
      documentationUrl: `${SITE_URL}/self-hosted-ai-agent/`,
    },
    entries: [
      {
        identifier: "urn:air:docs:llms",
        displayName: "Unibots agent guide",
        type: "text/plain",
        url: `${SITE_URL}/llms.txt`,
        description: "Product overview, agent-assisted setup guidance, and canonical resources.",
      },
      {
        identifier: "urn:air:docs:overview",
        displayName: "Unibots overview",
        type: "text/markdown",
        url: `${SITE_URL}/index.md`,
        description: "Features, model choices, self-hosting, and common questions.",
      },
      {
        identifier: "urn:air:docs:self-host",
        displayName: "Self-hosting guide",
        type: "text/html",
        url: `${SITE_URL}/self-hosted-ai-agent/`,
        description: "Requirements, installation, and connecting desktop and mobile clients.",
      },
      {
        identifier: "urn:air:docs:self-host-markdown",
        displayName: "Self-hosting guide as Markdown",
        type: "text/markdown",
        url: `${SITE_URL}/self-hosted-ai-agent.md`,
        description: "The setup guide with language-tagged command examples.",
      },
    ],
  };
  return new Response(`${JSON.stringify(catalog, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
