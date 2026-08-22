import type { SitePage } from "./site-pages";

/**
 * A sitemaps.org 0.9 document for everr.dev.
 *
 * `lastmod` is written only for pages that record a real date (blog and
 * devlog posts). Stamping build time onto every URL would be a lie crawlers
 * learn to ignore, and the protocol makes the field optional.
 */
export function buildSitemapXml(siteUrl: string, pages: SitePage[]): string {
  const entries = pages.map((page) => sitemapEntry(siteUrl, page)).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</urlset>",
    "",
  ].join("\n");
}

function sitemapEntry(siteUrl: string, page: SitePage): string {
  const lines = [
    "  <url>",
    `    <loc>${escapeXml(`${siteUrl}${page.path}`)}</loc>`,
  ];

  if (page.lastModified) {
    lines.push(`    <lastmod>${escapeXml(page.lastModified)}</lastmod>`);
  }

  lines.push(
    `    <changefreq>${page.changeFrequency}</changefreq>`,
    `    <priority>${page.priority.toFixed(1)}</priority>`,
    "  </url>",
  );

  return lines.join("\n");
}

export function buildRobotsTxt(siteUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "# Machine-readable descriptions of this site and of the Everr API.",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
    "# Non-standard, but widely read by agents:",
    `# ${siteUrl}/llms.txt      what Everr is and when to use it`,
    `# ${siteUrl}/llms-full.txt the whole documentation as one file`,
    `# ${siteUrl}/openapi.json  the Everr Cloud API description`,
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
