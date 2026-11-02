import react from "@astrojs/react";
import { satteri } from "@astrojs/markdown-satteri";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { isIndexedPath } from "./src/blog/indexability.ts";
import { docsCallouts } from "./src/docs-callouts.ts";
import { LOCALE_HREFLANG, LOCALES } from "./src/i18n/locales.ts";
import { resolveWwwPort } from "./www-port.mjs";

const wwwPort = resolveWwwPort();

// Canonical origin for the sitemap and canonical tags. Set PUBLIC_SITE_URL on the deployment;
// the default keeps local builds coherent without claiming a domain this project does not own.
const site = (process.env.PUBLIC_SITE_URL ?? "http://localhost:4321").replace(/\/$/, "");

export default defineConfig({
  site,
  output: "static",
  i18n: {
    defaultLocale: "en",
    locales: [...LOCALES],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) => isIndexedPath(new URL(page).pathname),
      i18n: {
        defaultLocale: "en",
        locales: LOCALE_HREFLANG,
      },
    }),
  ],
  markdown: {
    processor: satteri({ hastPlugins: [docsCallouts] }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    host: "127.0.0.1",
    port: wwwPort,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: wwwPort,
  },
});
