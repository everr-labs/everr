// The pages that exist in Italian too, by English path, with their Italian URL.
// project.inlang/paraglide.config.ts builds its URL patterns from this map, so it is
// the only place to add one. The blog is not listed: its Italian URLs are the English ones
// under /it, mapped by their own pattern there. No path aliases here: the paraglide CLI
// loads this file outside Vite.
export const TRANSLATED_PATHS = {
  "/": "/it",
  "/pricing": "/it/prezzi",
  "/contact": "/it/contatti",
  "/about": "/it/chi-siamo",
} as const;

// Every blog post exists in every language: source.config.ts fails the build otherwise
export type TranslatedPath = keyof typeof TRANSLATED_PATHS | "/blog" | `/blog/${string}`;

export function isTranslatedPath(path: string): path is TranslatedPath {
  return (
    Object.hasOwn(TRANSLATED_PATHS, path) ||
    path === "/blog" ||
    (path.startsWith("/blog/") && path.length > "/blog/".length && !path.includes("/", 6))
  );
}
