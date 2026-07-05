import { describe, expect, it } from "vite-plus/test";
import {
  docsMarkdownPathToSlugs,
  docsMarkdownResponse,
  getLLMText,
  markdownDocsLinks,
  markdownResponse,
} from "./llms";

describe("docs LLM helpers", () => {
  it("renders a docs page as Markdown with a canonical title and URL", async () => {
    const text = await getLLMText({
      url: "/docs/getting-started/install",
      data: {
        title: "Install",
        getText: async (type) => {
          expect(type).toBe("processed");
          return "Run the installer from a terminal.";
        },
      },
    });

    expect(text).toBe(
      "# Install (/docs/getting-started/install)\n\nRun the installer from a terminal.",
    );
  });

  it("maps docs Markdown paths to Fumadocs slugs", () => {
    expect(docsMarkdownPathToSlugs("/docs/getting-started/install.md")).toEqual([
      "getting-started",
      "install",
    ]);
    expect(docsMarkdownPathToSlugs("/docs/index.md")).toEqual([]);
    expect(docsMarkdownPathToSlugs("/docs.md")).toEqual([]);
  });

  it("rejects non-docs Markdown paths and path traversal segments", () => {
    expect(docsMarkdownPathToSlugs("/devlog/example.md")).toBeNull();
    expect(docsMarkdownPathToSlugs("/docs/getting-started/install")).toBeNull();
    expect(docsMarkdownPathToSlugs("/docs/../secret.md")).toBeNull();
  });

  it("serves Markdown responses with a text/markdown content type", async () => {
    const response = markdownResponse("# Install");

    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("# Install");
  });

  it("serves a matching docs page as Markdown", async () => {
    const response = await docsMarkdownResponse(
      {
        getPage(slugs) {
          expect(slugs).toEqual(["reference", "cli"]);
          return {
            url: "/docs/reference/cli",
            data: {
              title: "CLI",
              getText: async () => "Use `everr --help`.",
            },
          };
        },
      },
      "/docs/reference/cli.md",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe("# CLI (/docs/reference/cli)\n\nUse `everr --help`.");
  });

  it("returns 404 when no Markdown docs page matches", async () => {
    const response = await docsMarkdownResponse(
      {
        getPage() {
          return undefined;
        },
      },
      "/docs/missing.md",
    );

    expect(response.status).toBe(404);
  });

  it("rewrites docs links in llms.txt to Markdown endpoints", () => {
    expect(
      markdownDocsLinks(
        [
          "- [Docs](/docs): Home",
          "- [Install](/docs/getting-started/install): Install Everr.",
          "- [Devlog](/devlog): Updates",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- [Docs](/docs.md): Home",
        "- [Install](/docs/getting-started/install.md): Install Everr.",
        "- [Devlog](/devlog): Updates",
      ].join("\n"),
    );
  });
});
