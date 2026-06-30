import { describe, expect, it } from "vitest";
import { markdownExcerpt } from "./excerpt";

describe("markdownExcerpt", () => {
  it("strips heading markers and collapses whitespace", () => {
    expect(markdownExcerpt("# Title\n\nSome   body  text")).toBe(
      "Title Some body text",
    );
  });

  it("keeps link text, drops the URL", () => {
    expect(markdownExcerpt("See [the docs](https://x.io) now")).toBe(
      "See the docs now",
    );
  });

  it("truncates with an ellipsis past maxChars", () => {
    expect(markdownExcerpt("abcdefghij", 5)).toBe("abcde…");
  });

  it("returns empty string for empty input", () => {
    expect(markdownExcerpt("")).toBe("");
  });
});
