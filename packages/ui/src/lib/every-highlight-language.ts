/// <reference types="vite-plus/client" />
import type { LanguageFn } from "highlight.js";

// Every grammar highlight.js ships, keyed by its file name. Loaded on its own
// (see components/highlighted-code.tsx), so only pages showing code outside
// the common set download it. The `.js.js` files are CommonJS twins of the same grammars.
const modules = import.meta.glob<LanguageFn>(
  [
    "../../node_modules/highlight.js/es/languages/*.js",
    "!../../node_modules/highlight.js/es/languages/*.js.js",
  ],
  { eager: true, import: "default" },
);

export const everyLanguage: Record<string, LanguageFn> = Object.fromEntries(
  Object.entries(modules).map(([path, grammar]) => [
    path.slice(path.lastIndexOf("/") + 1, -".js".length),
    grammar,
  ]),
);
