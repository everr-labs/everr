import { SITE_URL } from "../src/constants";
import { publishedDevlog } from "../src/lib/markdown-pages";
import { buildSitemap, type SitemapEntry } from "../src/lib/sitemap";
import { listSitePages, source } from "../src/lib/source";
import { TRANSLATED_PATHS } from "../src/lib/translated";
import { locales, localizeHref } from "../src/paraglide/runtime";

// Every translated page is listed once per language, each with all its alternates
function translated(path: string): SitemapEntry[] {
  const alternates: Record<string, string> = {};
  for (const locale of locales) alternates[locale] = SITE_URL + localizeHref(path, { locale });
  alternates["x-default"] = SITE_URL + localizeHref(path, { locale: "en" });
  return locales.map((locale) => ({ loc: alternates[locale], alternates }));
}

export default function handler() {
  const devlog = publishedDevlog();
  const entries: SitemapEntry[] = [
    ...TRANSLATED_PATHS.flatMap(translated),
    ...listSitePages().map((page) => ({ loc: SITE_URL + page.url })),
    ...source.getPages().map((page) => ({ loc: SITE_URL + page.url })),
    { loc: `${SITE_URL}/devlog`, lastmod: devlog[0]?.date },
    ...devlog.map((post) => ({ loc: `${SITE_URL}/devlog/${post.slug}`, lastmod: post.date })),
  ];

  return new Response(buildSitemap(entries), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
