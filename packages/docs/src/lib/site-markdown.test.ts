import { afterEach, describe, expect, it } from "vite-plus/test";
import { baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { blogIndexMarkdown, docsSections, llmsTxt, pricingMarkdown } from "./site-markdown";

const DOCS_INDEX = `# Docs

- [What Everr is](/docs.md): Observability made simple
- Getting started
  - [Installation](/docs/learn/install.md): Install the CLI.
- Guides
  - [Production telemetry](/docs/guides/production-telemetry.md): Send OTLP.

  - **CI**
  - [Debug Your CI](/docs/guides/debug-ci.md): Investigate CI failures.`;

describe("llms.txt", () => {
  const text = llmsTxt(
    DOCS_INDEX,
    [{ slug: "first", title: "First post", description: "What shipped.", date: "2026-05-01" }],
    [
      {
        slug: "tracing",
        title: "Tracing post",
        description: "Why it matters.",
        date: "2026-11-17",
      },
    ],
  );

  it("follows the llms.txt layout: title, summary, guidance, then sections", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Everr");
    expect(lines[2]).toMatch(/^> /);
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(text.match(/^#{3,} /gm)).toBeNull();
  });

  it("holds only lists of links in its sections", () => {
    const sections = text.split(/^## .*$/m).slice(1);
    for (const section of sections) {
      const lines = section.split("\n").filter((line) => line.trim() !== "");
      for (const line of lines) expect(line).toMatch(/^- \[[^\]]+\]\([^)]+\)/);
    }
  });

  it("tells agents when to use Everr before the sections", () => {
    const guidance = text.slice(0, text.indexOf("\n## "));
    expect(guidance).toContain("**When to use Everr.**");
    expect(guidance).toContain("**How an agent should use Everr:**");
    expect(text).toContain("[MCP server](/docs/reference/mcp.md)");
  });

  it("offers the CLI through Homebrew", () => {
    expect(text).toContain("`brew install everr-labs/tap/everr`");
    expect(text).toContain("[Homebrew tap](https://github.com/everr-labs/homebrew-tap)");
  });

  it("lists the devlog under Optional", () => {
    expect(text).toContain("## Optional");
    expect(text).toContain("- [First post](/devlog/first): What shipped.");
  });

  it("lists the blog under Optional", () => {
    const optional = text.slice(text.indexOf("## Optional"));
    expect(optional).toContain("- [Blog](/blog): ");
    expect(optional).toContain("- [Tracing post](/blog/tracing): Why it matters.");
  });
});

describe("blog index Markdown", () => {
  it("lists each post with its date, link and description", () => {
    const text = blogIndexMarkdown(
      [
        {
          slug: "tracing",
          title: "Tracing post",
          description: "Why it matters.",
          date: "2026-11-17",
        },
      ],
      "en",
    );
    expect(text).toContain("# Everr Blog");
    expect(text).toContain("- 2026-11-17: [Tracing post](/blog/tracing): Why it matters.");
  });

  it("answers in the requested language, with its URLs", () => {
    const text = blogIndexMarkdown(
      [{ slug: "tracing", title: "Post", description: "Perché conta.", date: "2026-11-17" }],
      "it",
    );
    expect(text).toContain("# Everr Blog");
    expect(text).toContain("Articoli su observability");
    expect(text).toContain("- 2026-11-17: [Post](/it/blog/tracing): Perché conta.");
  });
});

describe("docs sections", () => {
  it("turns each top-level docs folder into a section of links", () => {
    expect(docsSections(DOCS_INDEX)).toBe(`## Docs

- [What Everr is](/docs.md): Observability made simple

## Docs: Getting started

- [Installation](/docs/learn/install.md): Install the CLI.

## Docs: Guides

- [Production telemetry](/docs/guides/production-telemetry.md): Send OTLP.
- [Debug Your CI](/docs/guides/debug-ci.md): Investigate CI failures.`);
  });
});

describe("pricing Markdown", () => {
  afterEach(() => overwriteGetLocale(() => baseLocale));

  it("lists every plan with its price", () => {
    const text = pricingMarkdown("en");
    expect(text).toContain("## Hobby: €0/month");
    expect(text).toContain("## Pro: €39/month");
    expect(text).toContain("## Enterprise");
  });

  it("keeps the links inside FAQ answers", () => {
    const text = pricingMarkdown("en");
    expect(text).toContain("[contact us](https://calendar.app.google/");
    expect(text).toContain("[retention guide](/docs/reference/retention)");
  });

  it("is written in the requested language, not the current one", () => {
    overwriteGetLocale(() => "en");
    expect(pricingMarkdown("it")).toContain("## Hobby: €0/mese");

    overwriteGetLocale(() => "it");
    expect(pricingMarkdown("en")).toContain("- Ingestion: 30 GB / month");
  });
});
