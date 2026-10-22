const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

type DocsPage = {
  url: string;
  data: {
    title: string;
    getText: (type: "processed") => Promise<string>;
  };
};

type DocsSource = {
  getPage: (slugs: string[]) => DocsPage | undefined;
};

export async function getLLMText(page: DocsPage) {
  const processed = await page.data.getText("processed");
  return `# ${page.data.title} (${page.url})\n\n${processed}`;
}

export function markdownResponse(markdown: string) {
  return new Response(markdown, {
    headers: {
      "content-type": MARKDOWN_CONTENT_TYPE,
    },
  });
}

export function textResponse(text: string) {
  return new Response(text, {
    headers: {
      "content-type": TEXT_CONTENT_TYPE,
    },
  });
}

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

export function docsMarkdownPathToSlugs(pathname: string) {
  if (pathname === "/docs.md") return [];
  if (!pathname.startsWith("/docs/") || !pathname.endsWith(".md")) {
    return null;
  }

  const slugPath = pathname.slice("/docs/".length, -".md".length);
  if (slugPath === "index") return [];
  if (slugPath.length === 0) return null;

  const encodedSegments = slugPath.split("/");
  if (encodedSegments.some((segment) => segment.length === 0)) return null;

  try {
    return encodedSegments.map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (decoded.length === 0 || decoded === "." || decoded === ".." || decoded.includes("/")) {
        throw new Error("Invalid docs Markdown path segment");
      }

      return decoded;
    });
  } catch {
    return null;
  }
}

export async function docsMarkdownResponse(source: DocsSource, pathname: string) {
  const slugs = docsMarkdownPathToSlugs(pathname);
  if (!slugs) return notFoundResponse();

  const page = source.getPage(slugs);
  if (!page) return notFoundResponse();

  return markdownResponse(await getLLMText(page));
}

function notFoundResponse() {
  return new Response("Not found", { status: 404 });
}
