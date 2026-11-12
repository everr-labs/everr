import { describe, expect, it } from "vite-plus/test";
import { pageHead, seoHead } from "./page-head";

describe("page head", () => {
  it("gives a page its canonical URL and Open Graph identity", () => {
    const head = seoHead({ path: "/about", title: "About Everr", description: "Who we are." });

    expect(head.links).toEqual([{ rel: "canonical", href: "https://everr.dev/about" }]);
    expect(head.meta).toEqual(
      expect.arrayContaining([
        { property: "og:type", content: "website" },
        { property: "og:url", content: "https://everr.dev/about" },
        { property: "og:image", content: "https://everr.dev/api/og/site" },
      ]),
    );
  });

  it("leaves the site description in place when the page has none", () => {
    const head = seoHead({ path: "/docs/x", title: "X - Everr Docs" });

    expect(head.meta.some((tag) => "name" in tag && tag.name === "description")).toBe(false);
  });

  it("links a translated page to each of its languages", () => {
    const head = pageHead("/contact", "Contact Everr", "How to reach us.");

    expect(head.links).toEqual(
      expect.arrayContaining([
        { rel: "alternate", hrefLang: "en", href: "https://everr.dev/contact" },
        { rel: "alternate", hrefLang: "it", href: "https://everr.dev/it/contact" },
        { rel: "alternate", hrefLang: "x-default", href: "https://everr.dev/contact" },
      ]),
    );
  });
});
