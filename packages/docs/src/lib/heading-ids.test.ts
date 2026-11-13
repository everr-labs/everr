import { describe, expect, it } from "vite-plus/test";
import { stripHeadingIds } from "./heading-ids";

describe("heading ids", () => {
  it("drops the anchor suffix from headings", () => {
    expect(stripHeadingIds("## What Everr does [#what-everr-does]\n\nText.")).toBe(
      "## What Everr does\n\nText.",
    );
  });

  it("leaves code blocks alone", () => {
    const code = "```sh\n# install [#not-a-heading]\n```";
    expect(stripHeadingIds(code)).toBe(code);
  });
});
