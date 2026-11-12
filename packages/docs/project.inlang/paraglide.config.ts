import { defineConfig } from "@inlang/paraglide-js";
import { TRANSLATED_PATHS } from "../src/lib/translated";

// The translated pages get an /it URL. Everything else, the docs and the devlog
// included, has one English URL
export default defineConfig({
  outdir: "./src/paraglide",
  outputStructure: "message-modules",
  // The URL alone decides the language: no cookie and no redirect by browser language
  strategy: ["url", "baseLocale"],
  // /it/ is the same page as /it
  trailingSlash: "never",
  urlPatterns: [
    ...TRANSLATED_PATHS.map((pattern) => ({
      pattern,
      localized: [
        ["it", pattern === "/" ? "/it" : `/it${pattern}`],
        ["en", pattern],
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
