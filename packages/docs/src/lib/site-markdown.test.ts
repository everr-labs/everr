import { afterEach, describe, expect, it } from "vite-plus/test";
import { baseLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { llmsTxt, pricingMarkdown } from "./site-markdown";

describe("llms.txt", () => {
  const text = llmsTxt("# Docs\n\n- [Install](/docs/learn/install.md): Install the CLI.", [
    { slug: "first", title: "First post", description: "What shipped.", date: "2026-05-01" },
  ]);

  it("follows the llms.txt layout: title, summary, then sections", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Everr");
    expect(lines[2]).toMatch(/^> /);
    expect(text.match(/^# /gm)).toHaveLength(1);
  });

  it("tells agents when to use Everr and lists developer resources", () => {
    expect(text).toContain("## When to use Everr");
    expect(text).toContain("## Developer resources");
    expect(text).toContain("[MCP server](/docs/reference/mcp.md)");
  });

  it("nests the docs index and the devlog under their own sections", () => {
    expect(text).toContain("## Docs\n\n- [Install](/docs/learn/install.md): Install the CLI.");
    expect(text).toContain("- [First post](/devlog/first): What shipped.");
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

  it("is written in the requested language, not the current one", () => {
    overwriteGetLocale(() => "en");
    expect(pricingMarkdown("it")).toContain("## Hobby: €0/mese");

    overwriteGetLocale(() => "it");
    expect(pricingMarkdown("en")).toContain("- Ingestion: 30 GB / month");
  });
});
