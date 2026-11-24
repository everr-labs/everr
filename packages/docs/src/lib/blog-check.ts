import { readdirSync, readFileSync } from "node:fs";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { z } from "zod";
import { pairBlogPosts } from "./blog-pairs";

const Frontmatter = z.object({ date: z.string(), draft: z.boolean().optional() });

/**
 * Reads `dir` the way the blog loader does and throws if a post lacks a language. The loader
 * only runs when the server renders, so source.config.ts calls this to fail the build, the
 * dev server and `fumadocs-mdx` early. Relative imports only: the Fumadocs CLI loads it
 * outside Vite.
 */
export function checkBlogContent(dir: string, locales: readonly string[], baseLocale: string) {
  const pages = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => ({
      slugs: file.replace(/\.mdx$/, "").split(/[\\/]/),
      data: Frontmatter.parse(frontmatter(readFileSync(`${dir}/${file}`, "utf8")).data),
    }));
  pairBlogPosts(pages, locales, baseLocale);
}
