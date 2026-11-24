import { defineConfig } from "@inlang/paraglide-js";
import { TRANSLATED_PATHS } from "../src/lib/translated";

// The translated pages get an Italian URL. Everything else, the docs and the devlog
// included, has one English URL. The blog and its share images keep their path under /it:
// /it/blog/<slug>, /it/api/og/blog/<slug>
export default defineConfig({
  outdir: "./src/paraglide",
  outputStructure: "message-modules",
  // The URL alone decides the language: no cookie and no redirect by browser language
  strategy: ["url", "baseLocale"],
  // /it/ is the same page as /it
  trailingSlash: "never",
  urlPatterns: [
    ...Object.entries(TRANSLATED_PATHS).map(([pattern, italian]) => ({
      pattern,
      localized: [
        ["it", italian],
        ["en", pattern],
      ] satisfies [string, string][],
    })),
    ...["/blog", "/api/og/blog"].map((prefix) => ({
      pattern: `${prefix}/:path(.*)?`,
      localized: [
        ["it", `/it${prefix}/:path(.*)?`],
        ["en", `${prefix}/:path(.*)?`],
      ] satisfies [string, string][],
    })),
    {
      pattern: "/:path(.*)?",
      localized: [
        ["en", "/:path(.*)?"],
        ["it", "/:path(.*)?"],
      ],
    },
  ],
});
