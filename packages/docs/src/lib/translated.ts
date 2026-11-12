// The pages that exist in more than one language. Keep in step with the URL
// patterns in project.inlang/paraglide.config.ts.
export const TRANSLATED_PATHS = ["/", "/pricing", "/contact"] as const;

export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

export function isTranslatedPath(path: string): path is TranslatedPath {
  return TRANSLATED_PATHS.some((translated) => translated === path);
}
