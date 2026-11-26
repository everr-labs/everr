import { baseLocale, type Locale, locales } from "@/paraglide/runtime";
import { pairBlogPosts } from "./blog-pairs";
import { blogposts } from "./source";

const posts = pairBlogPosts(blogposts.getPages(), locales, baseLocale);

/** A published post in `locale`; a draft does not exist yet */
export function blogPost(slug: string, locale: Locale) {
  const page = posts.get(slug)?.[locale];
  return page && !page.data.draft ? page : undefined;
}

/** The published posts in `locale`, newest first */
export function blogPosts(locale: Locale) {
  return [...posts]
    .map(([slug, versions]) => ({ slug, page: versions[locale] }))
    .filter(({ page }) => !page.data.draft)
    .map(({ slug, page }) => ({
      slug,
      title: page.data.title,
      description: page.data.description,
      date: page.data.date,
      author: page.data.author,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
