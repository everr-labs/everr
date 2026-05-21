import { defineConfig, defineDocs, defineCollections } from 'fumadocs-mdx/config';
import { z } from 'zod';

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const docs = defineDocs({
  dir: 'content/docs',
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export const devlog = defineCollections({
  type: 'doc',
  dir: 'content/devlog',
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
  type: 'doc',
  dir: 'content/blog',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().date(),
    author: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

/** @expected-unused — read by fumadocs build pipeline, not by TS imports. */
export default defineConfig();
