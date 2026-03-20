import { blog, docs } from "fumadocs-mdx:collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: "/docs",
  plugins: [lucideIconsPlugin()],
});

export const blogposts = loader({
  source: toFumadocsSource(blog, []),
  baseUrl: "/blog",
});
