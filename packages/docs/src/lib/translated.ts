// The pages that exist in Italian too, by English path, with their Italian URL.
// project.inlang/paraglide.config.ts builds its URL patterns from this map, so it is
// the only place to add one. No path aliases here: the paraglide CLI loads this file
// outside Vite.
export const TRANSLATED_PATHS = {
  "/": "/it",
  "/pricing": "/it/prezzi",
  "/contact": "/it/contatti",
} as const;

export type TranslatedPath = keyof typeof TRANSLATED_PATHS;

export function isTranslatedPath(path: string): path is TranslatedPath {
  return Object.hasOwn(TRANSLATED_PATHS, path);
}
