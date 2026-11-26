type PostPage = { slugs: string[]; data: { draft?: boolean; date: string } };

// content/blog holds the English posts at its root and each translation in a folder named
// after its language: it/tracing.mdx is the Italian version of tracing.mdx
function blogFile(slug: string, locale: string, baseLocale: string) {
  return locale === baseLocale ? `content/blog/${slug}.mdx` : `content/blog/${locale}/${slug}.mdx`;
}

function languageName(locale: string) {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
}

/**
 * Groups the loader's pages into one entry per post, with its page in every language.
 * A post that exists in only some languages, or whose date or draft flag differs between
 * them, throws: a post cannot ship in one language.
 */
export function pairBlogPosts<Locale extends string, Page extends PostPage>(
  pages: Page[],
  locales: readonly Locale[],
  baseLocale: Locale,
): Map<string, Record<Locale, Page>> {
  const bySlug = new Map<string, Partial<Record<Locale, Page>>>();

  for (const page of pages) {
    const [first, ...rest] = page.slugs;
    const translation = locales.find((locale) => locale !== baseLocale && locale === first);
    const slug = translation ? rest.join("/") : page.slugs.join("/");
    const locale = translation ?? baseLocale;
    if (slug === "" || slug.includes("/")) {
      throw new Error(
        `Unexpected blog file "${page.slugs.join("/")}": a post is content/blog/<slug>.mdx or content/blog/<language>/<slug>.mdx`,
      );
    }
    bySlug.set(slug, { ...bySlug.get(slug), [locale]: page });
  }

  const isComplete = (versions: Partial<Record<Locale, Page>>): versions is Record<Locale, Page> =>
    locales.every((locale) => versions[locale]);

  const posts = new Map<string, Record<Locale, Page>>();
  for (const [slug, complete] of bySlug) {
    if (!isComplete(complete)) {
      const missing = locales.find((locale) => !complete[locale]) ?? baseLocale;
      throw new Error(
        `Blog post "${slug}" has no ${languageName(missing)} version: add ${blogFile(slug, missing, baseLocale)}`,
      );
    }
    const base = complete[baseLocale];
    for (const locale of locales) {
      const { date, draft = false } = complete[locale].data;
      if (date !== base.data.date) {
        throw new Error(
          `Blog post "${slug}" has date ${base.data.date} in ${blogFile(slug, baseLocale, baseLocale)} but ${date} in ${blogFile(slug, locale, baseLocale)}: both versions need the same date`,
        );
      }
      if (draft !== (base.data.draft ?? false)) {
        throw new Error(
          `Blog post "${slug}" is a draft in only one language (${blogFile(slug, draft ? locale : baseLocale, baseLocale)}): both versions need the same draft value`,
        );
      }
    }
    posts.set(slug, complete);
  }
  return posts;
}
