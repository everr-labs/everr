export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  // hreflang to URL, for pages available in several languages
  alternates?: Record<string, string>;
};

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// https://www.sitemaps.org/protocol.html, with hreflang alternates as Google documents them
export function buildSitemap(entries: SitemapEntry[]) {
  const urls = entries.map((entry) => {
    const lines = [`    <loc>${escapeXml(entry.loc)}</loc>`];
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    for (const [hreflang, href] of Object.entries(entry.alternates ?? {})) {
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(hreflang)}" href="${escapeXml(href)}"/>`,
      );
    }
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}
