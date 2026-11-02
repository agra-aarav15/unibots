import { next } from "@vercel/functions";
import {
  AGENT_DISCOVERY_LINKS,
  getMarkdownAlternate,
  getMarkdownDocument,
  markdownResponse,
  negotiateRepresentation,
} from "./src/agent-content.js";

const VARY_HEADER = "Accept, Accept-Encoding";

/**
 * Canonical origin for the www redirect and the /sitemap.xml alias.
 *
 * Set `PUBLIC_SITE_URL` on the deployment. Without it the middleware does not redirect
 * anywhere, so a preview or self-hosted copy is never sent to a domain it does not own.
 */
const SITE_URL = process.env.PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";

function wwwHostOf(origin: string): string | null {
  try {
    const { hostname } = new URL(origin);
    return hostname.startsWith("www.") ? hostname : `www.${hostname}`;
  } catch {
    return null;
  }
}

export const config = {
  matcher: ["/((?!api|_astro|.*\\..*).*)", "/sitemap.xml"],
};

function permanentRedirect(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: { Location: location },
  });
}

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  const wwwHost = SITE_URL ? wwwHostOf(SITE_URL) : null;

  if (wwwHost && url.hostname.toLowerCase() === wwwHost) {
    const destination = new URL(`${url.pathname}${url.search}`, SITE_URL);
    return permanentRedirect(destination.toString());
  }

  if (url.pathname === "/sitemap.xml" && SITE_URL) {
    const destination = new URL(`/sitemap-index.xml${url.search}`, SITE_URL);
    return permanentRedirect(destination.toString());
  }

  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const acceptHeader = request.headers.get("accept");
  const representation = negotiateRepresentation(acceptHeader);
  const markdown = getMarkdownDocument(url.pathname);

  if (representation === "markdown" && markdown) {
    return markdownResponse(markdown, request.method);
  }

  if (representation === "not-acceptable") {
    return new Response(
      request.method === "HEAD"
        ? null
        : "Not acceptable. Request text/html or text/markdown.\n",
      {
        status: 406,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Vary: VARY_HEADER,
        },
      },
    );
  }

  const markdownAlternate = getMarkdownAlternate(url.pathname);
  return next({
    headers: {
      Link: [
        AGENT_DISCOVERY_LINKS,
        ...(markdownAlternate
          ? [`<${markdownAlternate}>; rel="alternate"; type="text/markdown"`]
          : []),
      ].join(", "),
      Vary: VARY_HEADER,
    },
  });
}
