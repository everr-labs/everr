// The pages that exist in Italian too, under /it. project.inlang/paraglide.config.ts
// builds its URL patterns from this list, so it is the only place to add one.
// No path aliases here: the paraglide CLI loads this file outside Vite.
export const TRANSLATED_PATHS = ["/", "/pricing", "/contact"] as const;

export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

export function isTranslatedPath(path: string): path is TranslatedPath {
  return TRANSLATED_PATHS.some((translated) => translated === path);
}
