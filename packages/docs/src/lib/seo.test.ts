import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  canonicalUrl,
  DEFAULT_OG_IMAGE_PATH,
  markdownUrl,
  pageSeoTags,
} from "./seo";

function metaValue(
  meta: Array<Record<string, string>>,
  key: "name" | "property",
  value: string,
) {
  return meta.find((tag) => tag[key] === value)?.content;
}

describe("pageSeoTags", () => {
  const { meta, links } = pageSeoTags({
    title: "Pricing - Everr",
    description: "What Everr costs.",
    path: "/pricing",
    ogType: "product",
  });

  it("emits the four signals agents use for entity resolution", () => {
    expect(meta.find((tag) => tag.title)?.title).toBe("Pricing - Everr");
    expect(metaValue(meta, "property", "og:type")).toBe("product");
    expect(metaValue(meta, "property", "og:image")).toContain("/api/og");
    expect(links.find((link) => link.rel === "canonical")?.href).toBe(
      canonicalUrl("/pricing"),
    );
  });

  it("defaults og:type to website and the image to the site card", () => {
    const home = pageSeoTags({
      title: "Everr",
      description: "Observability made simple.",
      path: "/",
    });

    expect(metaValue(home.meta, "property", "og:type")).toBe("website");
    expect(metaValue(home.meta, "property", "og:image")).toBe(
      absoluteUrl(DEFAULT_OG_IMAGE_PATH),
    );
  });

  it("advertises the Markdown twin as an alternate", () => {
    const alternate = links.find((link) => link.rel === "alternate");

    expect(alternate?.type).toBe("text/markdown");
    expect(alternate?.href).toBe(markdownUrl(canonicalUrl("/pricing")));
  });

  it("adds article:published_time only for dated pages", () => {
    expect(
      metaValue(meta, "property", "article:published_time"),
    ).toBeUndefined();

    const post = pageSeoTags({
      title: "A post",
      description: "Something happened.",
      path: "/devlog/a-post",
      ogType: "article",
      publishedTime: "2026-08-01",
    });

    expect(metaValue(post.meta, "property", "article:published_time")).toBe(
      "2026-08-01",
    );
  });
});

describe("canonicalUrl and markdownUrl", () => {
  it("keeps the root path as a single trailing slash", () => {
    expect(canonicalUrl("/", "https://everr.dev")).toBe("https://everr.dev/");
    expect(canonicalUrl("/about", "https://everr.dev")).toBe(
      "https://everr.dev/about",
    );
  });

  it("names the index Markdown file for the root", () => {
    expect(markdownUrl("https://everr.dev/")).toBe(
      "https://everr.dev/index.md",
    );
    expect(markdownUrl("https://everr.dev/about")).toBe(
      "https://everr.dev/about.md",
    );
  });
});
