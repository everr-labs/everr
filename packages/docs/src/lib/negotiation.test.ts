import { describe, expect, it } from "vite-plus/test";
import { HTML, MARKDOWN, negotiateNotFound, negotiatePage } from "./negotiation";

describe("page negotiation", () => {
  it.each([
    [null, HTML],
    ["", HTML],
    ["*/*", HTML],
    ["text/*", HTML],
    ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", HTML],
    ["text/markdown", MARKDOWN],
    ["text/markdown, text/html, */*", MARKDOWN],
    ["text/html, text/markdown", MARKDOWN],
    ["text/markdown;q=0.5, text/html", HTML],
    ["text/markdown;q=0, text/html", HTML],
    ["text/html;q=0.5, text/markdown;q=0.9", MARKDOWN],
    ["TEXT/MARKDOWN", MARKDOWN],
  ])("Accept %j gets %s", (accept, expected) => {
    expect(negotiatePage(accept)).toBe(expected);
  });

  it.each(["application/json", "text/markdown;q=0", "text/html;q=0, text/markdown;q=0"])(
    "Accept %j is not acceptable",
    (accept) => {
      expect(negotiatePage(accept)).toBeNull();
    },
  );
});

describe("404 negotiation", () => {
  it("gives browsers the HTML page", () => {
    expect(
      negotiateNotFound("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    ).toBe(HTML);
  });

  it.each([null, "*/*", "text/markdown", "application/json"])(
    "gives Accept %j a Markdown body",
    (accept) => {
      expect(negotiateNotFound(accept)).toBe(MARKDOWN);
    },
  );
});
