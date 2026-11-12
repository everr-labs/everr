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

export function getSitePage(slug: string) {
  // A decoded %2F would reach a nested page: only a single segment names one
  if (slug.includes("/")) return undefined;
  return sitePages.getPage([slug]);
}

export function listSitePages() {
  return sitePages.getPages();
}
