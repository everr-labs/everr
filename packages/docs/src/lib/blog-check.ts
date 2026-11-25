import { readdirSync, readFileSync } from "node:fs";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { z } from "zod";
import { pairBlogPosts } from "./blog-pairs";
import { mermaidTitle } from "./mermaid-title";

const Frontmatter = z.object({ date: z.string(), draft: z.boolean().optional() });

const MERMAID_FENCE = /^```mermaid[^\n]*\n([\s\S]*?)^```/gm;

function checkMermaidTitles(file: string, source: string) {
  for (const [, chart] of source.matchAll(MERMAID_FENCE)) {
    if (!mermaidTitle(chart)) {
      throw new Error(
        `A mermaid diagram in ${file} has no title: start the diagram with a frontmatter block (--- / title: ... / ---) so it has an accessible name`,
      );
    }
  }
}

/**
 * Reads `dir` the way the blog loader does and throws if a post lacks a language or has a
 * mermaid diagram without a title. The loader only runs when the server renders, so
 * source.config.ts calls this to fail the build, the dev server and `fumadocs-mdx` early.
 * Relative imports only: the Fumadocs CLI loads it outside Vite.
 */
export function checkBlogContent(dir: string, locales: readonly string[], baseLocale: string) {
  const pages = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => {
      const source = readFileSync(`${dir}/${file}`, "utf8");
      checkMermaidTitles(`${dir}/${file}`, source);
      return {
        slugs: file.replace(/\.mdx$/, "").split(/[\\/]/),
        data: Frontmatter.parse(frontmatter(source).data),
      };
    });
  pairBlogPosts(pages, locales, baseLocale);
}
