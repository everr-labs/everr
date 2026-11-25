import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { checkBlogContent } from "./blog-check";

const dirs: string[] = [];

function blogDir(files: Record<string, string>, body = "Body") {
  const dir = mkdtempSync(join(tmpdir(), "blog-"));
  dirs.push(dir);
  for (const [file, date] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), `---\ntitle: T\ndate: "${date}"\n---\n\n${body}\n`);
  }
  return dir;
}

const both = { "tracing.mdx": "2026-11-17", "it/tracing.mdx": "2026-11-17" };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("blog content check", () => {
  it("accepts a post in both languages", () => {
    const dir = blogDir({ "tracing.mdx": "2026-11-17", "it/tracing.mdx": "2026-11-17" });
    expect(() => checkBlogContent(dir, ["en", "it"], "en")).not.toThrow();
  });

  it("fails on a post missing its Italian file", () => {
    const dir = blogDir({ "tracing.mdx": "2026-11-17" });
    expect(() => checkBlogContent(dir, ["en", "it"], "en")).toThrow(
      "add content/blog/it/tracing.mdx",
    );
  });

  it("accepts a mermaid diagram with a title", () => {
    const dir = blogDir(both, "```mermaid\n---\ntitle: A name\n---\nflowchart LR\n```");
    expect(() => checkBlogContent(dir, ["en", "it"], "en")).not.toThrow();
  });

  it("fails on a mermaid diagram without a title, naming the file", () => {
    const dir = blogDir(both, "```mermaid\nflowchart LR\n  A --> B\n```");
    expect(() => checkBlogContent(dir, ["en", "it"], "en")).toThrow(/tracing\.mdx has no title/);
  });
});
