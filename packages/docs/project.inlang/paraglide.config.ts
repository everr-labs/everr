import { defineConfig } from "@inlang/paraglide-js";

// Only the landing, pricing and contact pages are translated. Everything else, the
// docs and the devlog included, has one English URL.
export default defineConfig({
  outdir: "./src/paraglide",
  outputStructure: "message-modules",
  // The URL alone decides the language: no cookie and no redirect by browser language
  strategy: ["url", "baseLocale"],
  // /it/ is the same page as /it
  trailingSlash: "never",
  urlPatterns: [
    {
      pattern: "/",
      localized: [
        ["it", "/it"],
        ["en", "/"],
      ],
    },
    {
      pattern: "/pricing",
      localized: [
        ["it", "/it/pricing"],
        ["en", "/pricing"],
      ],
    },
    {
      pattern: "/contact",
      localized: [
        ["it", "/it/contact"],
        ["en", "/contact"],
      ],
    },
    {
      pattern: "/:path(.*)?",
      localized: [
        ["en", "/:path(.*)?"],
        ["it", "/:path(.*)?"],
      ],
    },
  ],
});
