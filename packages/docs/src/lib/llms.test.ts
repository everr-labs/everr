import { describe, expect, it } from "vitest";
import { getLLMText, markdownDocsLinks, textResponse } from "./llms";

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

  it("serves plain-text responses with a charset", async () => {
    const response = textResponse("User-agent: *");

    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("User-agent: *");
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
