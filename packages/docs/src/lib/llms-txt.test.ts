import { describe, expect, it, vi } from "vitest";

vi.mock("./site-pages", () => ({
  getStaticPages: () => [
    {
      path: "/about",
      title: "About Everr",
      description: "Who builds Everr.",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      path: "/blog",
      title: "Blog",
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ],
  getBlogPages: () => [],
  getDevlogPages: () => [
    {
      path: "/devlog/a-post",
      title: "A post",
      description: "What shipped.",
      lastModified: "2026-08-01",
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ],
}));

const { buildLlmsTxt } = await import("./llms-txt");

const DOCS_INDEX = [
  "# Docs",
  "",
  "- [What Everr is](/docs): Observability",
  "  - [Install](/docs/learn/install): Step 1",
].join("\n");

const llms = buildLlmsTxt("https://everr.dev", DOCS_INDEX);

describe("llms.txt", () => {
  it("opens with the H1 and the required blockquote summary", () => {
    const lines = llms.split("\n");

    expect(lines[0]).toBe("# Everr");
    expect(lines[1]).toBe("");
    expect(lines[2]?.startsWith("> ")).toBe(true);
  });

  it("puts the free-form content before the first H2", () => {
    const firstHeading = llms.indexOf("\n## ");
    const preamble = llms.slice(0, firstHeading);

    expect(preamble).toContain("Reach for Everr when:");
    expect(preamble).toContain("Everr is the wrong tool when:");
    expect(preamble).not.toMatch(/\n#{1,6} (?!Everr\b)/);
  });

  it("says how to authenticate and how to install the CLI", () => {
    expect(llms).toContain("Authorization: Bearer");
    expect(llms).toContain("https://everr.dev/install.sh");
  });

  it("lists the machine-readable entry points first", () => {
    expect(llms).toContain("## Start here");
    expect(llms).toContain("[/openapi.json](https://everr.dev/openapi.json)");
    expect(llms).toContain("[/sitemap.xml](https://everr.dev/sitemap.xml)");
    expect(llms).toContain("[/llms-full.txt](https://everr.dev/llms-full.txt)");
  });

  it("folds the generated docs index in as one H2 list with Markdown links", () => {
    expect(llms).toContain("## Documentation");
    expect(llms).not.toContain("# Docs\n");
    expect(llms).toContain("[What Everr is](https://everr.dev/docs.md)");
    expect(llms).toContain(
      "[Install](https://everr.dev/docs/learn/install.md)",
    );
  });

  it("keeps secondary reading under the Optional heading", () => {
    const optional = llms.slice(llms.indexOf("## Optional"));

    expect(optional).toContain("[A post](https://everr.dev/devlog/a-post.md)");
  });

  it("uses only H1 and H2 headings", () => {
    const headings = [...llms.matchAll(/^(#+) /gm)].map(
      (match) => match[1]?.length,
    );

    expect(headings.filter((level) => level === 1).length).toBe(1);
    expect(headings.every((level) => level === 1 || level === 2)).toBe(true);
  });
});
