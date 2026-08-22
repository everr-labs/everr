import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  findTrustPage,
  TRUST_PAGES,
  trustPageMarkdown,
} from "./trust-pages";

describe("trust pages", () => {
  it("publishes about, contact and privacy", () => {
    expect(TRUST_PAGES.map((page) => page.path)).toEqual([
      "/about",
      "/contact",
      "/privacy",
    ]);
  });

  it("gives each page enough content for a reader to judge the business", () => {
    for (const page of TRUST_PAGES) {
      const markdown = trustPageMarkdown(page);
      expect(markdown.length, page.path).toBeGreaterThan(500);
      expect(page.description, page.path).toBeTruthy();
      expect(page.metaTitle, page.path).toContain("Everr");
    }
  });

  it("names a way to reach a human on contact and privacy", () => {
    expect(trustPageMarkdown(findTrustPage("/contact") as never)).toContain(
      CONTACT_EMAIL,
    );
    expect(trustPageMarkdown(findTrustPage("/privacy") as never)).toContain(
      CONTACT_EMAIL,
    );
  });

  it("renders headings, paragraphs and bullets as Markdown", () => {
    const markdown = trustPageMarkdown({
      path: "/example",
      title: "Example",
      metaTitle: "Example - Everr",
      headline: "Example",
      description: "An example.",
      intro: ["First line."],
      sections: [
        {
          heading: "A heading",
          paragraphs: ["A paragraph."],
          bullets: ["A bullet."],
        },
      ],
    });

    expect(markdown).toBe(
      [
        "# Example",
        "",
        "First line.",
        "",
        "## A heading",
        "",
        "A paragraph.",
        "",
        "- A bullet.",
        "",
      ].join("\n"),
    );
  });

  it("has no page without a matching path lookup", () => {
    for (const page of TRUST_PAGES) {
      expect(findTrustPage(page.path)).toBe(page);
    }
    expect(findTrustPage("/nope")).toBeUndefined();
  });
});
