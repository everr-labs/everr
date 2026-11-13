import { devlog, docs, pages } from "fumadocs-mdx:collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
  plugins: [lucideIconsPlugin()],
});

export const devlogposts = loader({
  source: toFumadocsSource(devlog, []),
  baseUrl: "/devlog",
});

const sitePages = loader({
  source: toFumadocsSource(pages, []),
  baseUrl: "/",
});

// content/pages holds the English pages at its root and translations in a folder per
// language: it/contact.mdx is the Italian /contact
export function getSitePage(slug: string, locale: string) {
  // /it%2Fcontact decodes to the slug "it/contact": only a single segment names a page
  if (slug.includes("/")) return undefined;
  if (locale !== "en") {
    const translated = sitePages.getPage([locale, slug]);
    if (translated) return translated;
  }
  return sitePages.getPage([slug]);
}

export function englishSitePages() {
  return sitePages.getPages().filter((page) => page.slugs.length === 1);
}
