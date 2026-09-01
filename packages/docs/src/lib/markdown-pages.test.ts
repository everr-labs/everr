import { describe, expect, it, vi } from "vitest";

function page(url: string, title: string, body: string, extra = {}) {
  return {
    url,
    data: {
      title,
      description: `${title} description`,
      getText: async () => body,
      ...extra,
    },
  };
}

const DOCS = new Map([
  ["", page("/docs", "What Everr is", "Read [Install](/docs/learn/install).")],
  ["learn/install", page("/docs/learn/install", "Install", "Run the script.")],
]);

const POSTS = new Map([
  [
    "a-post",
    page("/devlog/a-post", "A post", "It shipped.", {
      date: "2026-08-01",
    }),
  ],
  [
    "a-draft",
    page("/devlog/a-draft", "A draft", "Not yet.", {
      date: "2026-08-02",
      draft: true,
    }),
  ],
]);

vi.mock("./source", () => ({
  source: { getPage: (slugs: string[]) => DOCS.get(slugs.join("/")) },
  blogposts: { getPage: () => undefined },
  devlogposts: { getPage: (slugs: string[]) => POSTS.get(slugs.join("/")) },
}));

vi.mock("./site-pages", () => ({
  normalizePagePath: (pathname: string) =>
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname,
  getBlogPages: () => [],
  getDevlogPages: () => [
    {
      path: "/devlog/a-post",
      title: "A post",
      description: "It shipped.",
      lastModified: "2026-08-01",
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ],
}));

const { renderPageMarkdown } = await import("./markdown-pages");

const SITE = "https://everr.dev";

describe("renderPageMarkdown", () => {
  it("summarizes the homepage with the guidance an agent needs", async () => {
    const markdown = (await renderPageMarkdown("/", SITE)) as string;

    expect(markdown.startsWith("# Everr")).toBe(true);
    expect(markdown).toContain("## When to use Everr");
    expect(markdown).toContain("## How to call Everr");
    expect(markdown).toContain(`${SITE}/openapi.json`);
  });

  it("serves the trust pages from their single source of truth", async () => {
    const markdown = (await renderPageMarkdown("/privacy", SITE)) as string;

    expect(markdown.startsWith("# Privacy policy")).toBe(true);
    expect(markdown).toContain("hello@everr.dev");
  });

  it("serves a docs page and rewrites its links to Markdown twins", async () => {
    const markdown = (await renderPageMarkdown(
      "/docs/learn/install",
      SITE,
    )) as string;

    expect(markdown).toBe("# Install (/docs/learn/install)\n\nRun the script.");

    const index = (await renderPageMarkdown("/docs", SITE)) as string;
    expect(index).toContain("[Install](/docs/learn/install.md)");
  });

  it("serves a devlog post with its date", async () => {
    const markdown = (await renderPageMarkdown(
      "/devlog/a-post",
      SITE,
    )) as string;

    expect(markdown).toContain("# A post (/devlog/a-post)");
    expect(markdown).toContain("2026-08-01");
    expect(markdown).toContain("It shipped.");
  });

  it("hides drafts", async () => {
    expect(await renderPageMarkdown("/devlog/a-draft", SITE)).toBeNull();
  });

  it("lists posts on the index pages", async () => {
    const markdown = (await renderPageMarkdown("/devlog", SITE)) as string;

    expect(markdown).toContain("# Everr devlog");
    expect(markdown).toContain(`[A post](${SITE}/devlog/a-post.md)`);
  });

  it("treats a trailing slash as the same page", async () => {
    expect(await renderPageMarkdown("/pricing/", SITE)).toBe(
      await renderPageMarkdown("/pricing", SITE),
    );
  });

  it("returns null for a path that is not a page", async () => {
    expect(await renderPageMarkdown("/nope", SITE)).toBeNull();
    expect(await renderPageMarkdown("/docs/missing", SITE)).toBeNull();
  });
});
