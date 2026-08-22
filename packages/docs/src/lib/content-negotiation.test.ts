import { describe, expect, it } from "vitest";
import {
  negotiateMediaType,
  wantsMarkdownExplicitly,
} from "./content-negotiation";

describe("negotiateMediaType", () => {
  it("keeps HTML for a browser", () => {
    expect(
      negotiateMediaType(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ),
    ).toBe("html");
  });

  it("serves Markdown when the client asks for it", () => {
    expect(negotiateMediaType("text/markdown")).toBe("markdown");
    expect(negotiateMediaType("text/markdown, text/html;q=0.5")).toBe(
      "markdown",
    );
  });

  it("serves Markdown to a client with no preference", () => {
    expect(negotiateMediaType(null)).toBe("markdown");
    expect(negotiateMediaType("")).toBe("markdown");
    expect(negotiateMediaType("*/*")).toBe("markdown");
  });

  it("serves JSON when JSON is preferred over HTML and Markdown", () => {
    expect(negotiateMediaType("application/json")).toBe("json");
    expect(negotiateMediaType("application/json;q=0.9, text/html;q=0.8")).toBe(
      "json",
    );
  });

  it("prefers HTML when the client ranks it above Markdown", () => {
    expect(negotiateMediaType("text/markdown;q=0.2, text/html;q=0.9")).toBe(
      "html",
    );
  });

  it("treats a q of 0 as a rejection", () => {
    expect(negotiateMediaType("text/html;q=0, text/markdown")).toBe("markdown");
    expect(negotiateMediaType("text/html;q=0, application/pdf")).toBe(
      "unacceptable",
    );
  });

  it("reports nothing servable when the client wants only an unrelated type", () => {
    expect(negotiateMediaType("image/png")).toBe("unacceptable");
  });
});

describe("wantsMarkdownExplicitly", () => {
  it("is true only when the client names text/markdown", () => {
    expect(wantsMarkdownExplicitly("text/markdown")).toBe(true);
    expect(wantsMarkdownExplicitly("text/markdown;q=1, text/html;q=0.9")).toBe(
      true,
    );
  });

  it("is false for a wildcard, so link previewers keep the rendered page", () => {
    expect(wantsMarkdownExplicitly("*/*")).toBe(false);
    expect(wantsMarkdownExplicitly(null)).toBe(false);
    expect(wantsMarkdownExplicitly("text/html,*/*;q=0.8")).toBe(false);
  });

  it("is false when the client prefers HTML over Markdown", () => {
    expect(wantsMarkdownExplicitly("text/markdown;q=0.1, text/html")).toBe(
      false,
    );
  });
});
