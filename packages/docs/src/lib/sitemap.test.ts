import { describe, expect, it } from "vitest";
import type { SitePage } from "./site-pages";
import { buildRobotsTxt, buildSitemapXml } from "./sitemap";

const PAGES: SitePage[] = [
  {
    path: "/",
    title: "Everr",
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/devlog/a-post",
    title: "A post",
    description: "Ampersands & angle <brackets>",
    lastModified: "2026-08-01",
    changeFrequency: "yearly",
    priority: 0.5,
  },
];

describe("buildSitemapXml", () => {
  const xml = buildSitemapXml("https://everr.dev", PAGES);

  it("declares the sitemaps.org 0.9 namespace", () => {
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("writes an absolute loc for every page", () => {
    expect(xml).toContain("<loc>https://everr.dev/</loc>");
    expect(xml).toContain("<loc>https://everr.dev/devlog/a-post</loc>");
  });

  it("writes lastmod only for pages that record a date", () => {
    expect(xml).toContain("<lastmod>2026-08-01</lastmod>");
    expect(xml.match(/<lastmod>/g)?.length).toBe(1);
  });

  it("writes changefreq and priority for every page", () => {
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<priority>0.5</priority>");
  });
});

describe("buildRobotsTxt", () => {
  const robots = buildRobotsTxt("https://everr.dev");

  it("allows crawling and points at the sitemap", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Sitemap: https://everr.dev/sitemap.xml");
  });

  it("mentions the agent-facing files as comments", () => {
    expect(robots).toContain("https://everr.dev/llms.txt");
    expect(robots).toContain("https://everr.dev/openapi.json");
  });
});
