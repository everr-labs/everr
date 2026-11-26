import { describe, expect, it } from "vite-plus/test";
import { blogPostingStructuredData, jsonLdScript, siteStructuredData } from "./structured-data";

describe("structured data", () => {
  it("describes the organization with a way to contact it", () => {
    const organization = siteStructuredData()["@graph"].find(
      (node) => node["@type"] === "Organization",
    );

    expect(organization).toMatchObject({
      name: "Everr",
      url: "https://everr.dev",
      email: "hello@everr.dev",
      contactPoint: [{ "@type": "ContactPoint", email: "hello@everr.dev" }],
    });
  });

  it("offers the CLI from the install script and the Homebrew tap", () => {
    const software = siteStructuredData()["@graph"].find(
      (node) => node["@type"] === "SoftwareApplication",
    );

    expect(software?.downloadUrl).toEqual([
      "https://everr.dev/install.sh",
      "https://github.com/everr-labs/homebrew-tap",
    ]);
  });

  it("cannot close its script element", () => {
    const script = jsonLdScript({ name: "</script><script>alert(1)</script>" });

    expect(script.type).toBe("application/ld+json");
    expect(script.children).not.toContain("</script>");
    expect(JSON.parse(script.children)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  describe("blog posting", () => {
    const post = {
      url: "https://everr.dev/it/blog/tracing",
      headline: "Tracing",
      description: "About tracing",
      datePublished: "2026-11-17",
      dateModified: "2026-11-20",
      image: "https://everr.dev/it/api/og/blog/tracing",
      inLanguage: "it",
    };

    it("describes the post and points at the organization", () => {
      expect(blogPostingStructuredData({ ...post, author: "Ada" })).toEqual({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "@id": post.url,
        mainEntityOfPage: post.url,
        url: post.url,
        headline: "Tracing",
        description: "About tracing",
        datePublished: "2026-11-17",
        dateModified: "2026-11-20",
        author: { "@type": "Person", name: "Ada" },
        image: post.image,
        inLanguage: "it",
        publisher: { "@id": "https://everr.dev/#organization" },
      });
    });

    it("omits the author when the post has none", () => {
      expect(blogPostingStructuredData(post)).not.toHaveProperty("author");
    });
  });
});
