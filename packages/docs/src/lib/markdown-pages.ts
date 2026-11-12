import { llms } from "fumadocs-core/source";
import { getLLMText, markdownDocsLinks } from "./llms";
import {
  type DevlogEntry,
  devlogIndexMarkdown,
  llmsTxt,
  pageMarkdown,
  pricingMarkdown,
} from "./site-markdown";
import { baseLocale, type Locale, localizeHref } from "@/paraglide/runtime";
import { devlogposts, getSitePage, source } from "./source";

export function publishedDevlog(): DevlogEntry[] {
  return devlogposts
    .getPages()
    .filter((post) => !post.data.draft)
    .map((post) => ({
      slug: post.slugs.join("/"),
      title: post.data.title,
      description: post.data.description,
      date: post.data.date,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function buildLlmsTxt() {
  return llmsTxt(markdownDocsLinks(llms(source).index()), publishedDevlog());
}

/**
 * The Markdown representation of a page, by its path without the locale prefix.
 * Pricing and the site pages answer in `locale`; the docs, the devlog and the home
 * page (the llms.txt index) are in English only.
 */
export async function markdownForPath(
  pathname: string,
  locale: Locale = baseLocale,
): Promise<string | undefined> {
  const path = pathname;
  const slugs: string[] = [];
  for (const segment of path.split("/").filter(Boolean)) {
    const decoded = safeDecode(segment);
    if (decoded === undefined) return undefined;
    slugs.push(decoded);
  }

  if (slugs.length === 0) return buildLlmsTxt();
  if (path === "/pricing") return pricingMarkdown(locale);
  if (path === "/devlog") return devlogIndexMarkdown(publishedDevlog());

  if (slugs[0] === "docs") {
    const page = source.getPage(slugs.slice(1));
    return page ? getLLMText(page) : undefined;
  }

  if (slugs[0] === "devlog" && slugs.length === 2) {
    const post = devlogposts.getPage([slugs[1]]);
    if (!post || post.data.draft) return undefined;
    return pageMarkdown(
      post.data.title,
      post.url,
      await post.data.getText("processed"),
      `${post.data.date}. ${post.data.description}`,
    );
  }

  if (slugs.length === 1) {
    const page = getSitePage(slugs[0], locale);
    if (!page) return undefined;
    return pageMarkdown(
      page.data.title,
      localizeHref(path, { locale }),
      await page.data.getText("processed"),
      page.data.description,
    );
  }

  return undefined;
}

function safeDecode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}
