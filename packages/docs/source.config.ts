import { readFileSync } from "node:fs";
import { defineConfig, defineDocs, defineCollections } from "fumadocs-mdx/config";
import { z } from "zod";
import { checkBlogContent } from "./src/lib/blog-check";

// The languages come from the inlang project: the paraglide runtime is compiled after this runs
const { baseLocale, locales } = z
  .object({ baseLocale: z.string(), locales: z.array(z.string()) })
  .parse(JSON.parse(readFileSync("project.inlang/settings.json", "utf8")));
checkBlogContent("content/blog", locales, baseLocale);

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const devlog = defineCollections({
  type: "doc",
  dir: "content/devlog",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().date(),
    author: z.string().optional(),
    draft: z.boolean().optional(),
    commits: z.number().optional(),
    prs: z.number().optional(),
    additions: z.number().optional(),
    deletions: z.number().optional(),
  }),
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const blog = defineCollections({
  type: "doc",
  dir: "content/blog",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().date(),
    author: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const pages = defineCollections({
  type: "doc",
  dir: "content/pages",
  postprocess: {
    includeProcessedMarkdown: true,
  },
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export default defineConfig();
