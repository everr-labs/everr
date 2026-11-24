import { describe, expect, it } from "vite-plus/test";
import { pairBlogPosts } from "./blog-pairs";

const locales = ["en", "it"] as const;

function page(slugs: string[], data: { date?: string; draft?: boolean } = {}) {
  return { slugs, data: { date: "2026-11-17", ...data } };
}

describe("blog posts", () => {
  it("pairs each post with its translation", () => {
    const en = page(["tracing"]);
    const it = page(["it", "tracing"]);

    const posts = pairBlogPosts([it, en], locales, "en");

    expect([...posts.keys()]).toEqual(["tracing"]);
    expect(posts.get("tracing")).toEqual({ en, it });
  });

  it("fails on a post without its Italian version, naming the file to add", () => {
    expect(() => pairBlogPosts([page(["tracing"])], locales, "en")).toThrow(
      'Blog post "tracing" has no Italian version: add content/blog/it/tracing.mdx',
    );
  });

  it("fails on a post without its English version, naming the file to add", () => {
    expect(() => pairBlogPosts([page(["it", "tracing"])], locales, "en")).toThrow(
      'Blog post "tracing" has no English version: add content/blog/tracing.mdx',
    );
  });

  it("fails when the two versions have different dates", () => {
    expect(() =>
      pairBlogPosts(
        [page(["tracing"]), page(["it", "tracing"], { date: "2026-11-18" })],
        locales,
        "en",
      ),
    ).toThrow(/"tracing" has date 2026-11-17 .* but 2026-11-18 in content\/blog\/it\/tracing\.mdx/);
  });

  it("fails when only one version is a draft", () => {
    expect(() =>
      pairBlogPosts([page(["tracing"], { draft: true }), page(["it", "tracing"])], locales, "en"),
    ).toThrow(/"tracing" is a draft in only one language \(content\/blog\/tracing\.mdx\)/);
  });

  it("accepts a draft in both languages", () => {
    const posts = pairBlogPosts(
      [page(["tracing"], { draft: true }), page(["it", "tracing"], { draft: true })],
      locales,
      "en",
    );
    expect(posts.size).toBe(1);
  });

  it("rejects a file outside the layout", () => {
    expect(() => pairBlogPosts([page(["series", "one"])], locales, "en")).toThrow(
      'Unexpected blog file "series/one"',
    );
  });
});
