import { describe, expect, it } from "vite-plus/test";
import { buildSitemap } from "./sitemap";

describe("sitemap", () => {
  it("lists each URL with its last modification and language alternates", () => {
    const xml = buildSitemap([
      {
        loc: "https://everr.dev/pricing",
        alternates: { en: "https://everr.dev/pricing", it: "https://everr.dev/it/prezzi" },
      },
      { loc: "https://everr.dev/devlog/a&b", lastmod: "2026-05-01" },
    ]);

    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://everr.dev/pricing</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://everr.dev/pricing"/>
    <xhtml:link rel="alternate" hreflang="it" href="https://everr.dev/it/prezzi"/>
  </url>
  <url>
    <loc>https://everr.dev/devlog/a&amp;b</loc>
    <lastmod>2026-05-01</lastmod>
  </url>
</urlset>
`);
  });
});
