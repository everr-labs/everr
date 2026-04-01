import { defineConfig, defineDocs, defineCollections } from 'fumadocs-mdx/config';
import { z } from 'zod';

export const docs = defineDocs({
  dir: 'content/docs',
});

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

export default defineConfig();
