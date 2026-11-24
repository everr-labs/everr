import { SITE_URL } from "../src/constants";
import { blogPosts } from "../src/lib/blog";
import { publishedDevlog } from "../src/lib/markdown-pages";
import { buildSitemap, type SitemapEntry } from "../src/lib/sitemap";
import { englishSitePages, source } from "../src/lib/source";
import { isTranslatedPath, TRANSLATED_PATHS } from "../src/lib/translated";
import { baseLocale, locales, localizeHref } from "../src/paraglide/runtime";

// Every translated page is listed once per language, each with all its alternates
function translated(path: string, lastmod?: string): SitemapEntry[] {
  const alternates: Record<string, string> = {};
  for (const locale of locales) alternates[locale] = SITE_URL + localizeHref(path, { locale });
  alternates["x-default"] = SITE_URL + localizeHref(path, { locale: "en" });
  return locales.map((locale) => ({ loc: alternates[locale], lastmod, alternates }));
}

export default function handler() {
  const devlog = publishedDevlog();
  const blog = blogPosts(baseLocale);
  const entries: SitemapEntry[] = [
    ...Object.keys(TRANSLATED_PATHS).flatMap((path) => translated(path)),
    ...englishSitePages()
      .filter((page) => !isTranslatedPath(page.url))
      .map((page) => ({ loc: SITE_URL + page.url })),
    ...source.getPages().map((page) => ({ loc: SITE_URL + page.url })),
    { loc: `${SITE_URL}/devlog`, lastmod: devlog[0]?.date },
    ...devlog.map((post) => ({ loc: `${SITE_URL}/devlog/${post.slug}`, lastmod: post.date })),
    ...translated("/blog", blog[0]?.date),
    ...blog.flatMap((post) => translated(`/blog/${post.slug}`, post.date)),
  ];

  return new Response(buildSitemap(entries), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
