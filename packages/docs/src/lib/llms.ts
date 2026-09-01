const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

type DocsPage = {
  url: string;
  data: {
    title: string;
    getText: (type: "processed") => Promise<string>;
  };
};

export async function getLLMText(page: DocsPage) {
  const processed = await page.data.getText("processed");
  return `# ${page.data.title} (${page.url})\n\n${processed}`;
}

export function textResponse(text: string) {
  return new Response(text, {
    headers: {
      "content-type": TEXT_CONTENT_TYPE,
    },
  });
}

/**
 * Rewrites in-site `/docs` links to their `.md` twins, so an agent reading
 * Markdown keeps getting Markdown as it follows links.
 */
export function markdownDocsLinks(text: string) {
  return text.replace(
    /\]\((\/docs(?:\/[^)\s?#]*)?)([?#][^)]*)?\)/g,
    (_match, url: string, suffix: string | undefined) =>
      `](${docsUrlToMarkdownPath(url)}${suffix ?? ""})`,
  );
}

function docsUrlToMarkdownPath(url: string) {
  if (url === "/docs") return "/docs.md";
  if (url === "/docs.md") return url;
  if (url.startsWith("/docs/") && !url.endsWith(".md")) {
    return `${url}.md`;
  }
  return url;
}
