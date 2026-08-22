import { getRequestURL } from "nitro/h3";
import { agentNotFoundResponse, markdownResponse } from "../src/lib/agent-errors";
import { pageForMarkdownPath } from "../src/lib/agent-request";
import { renderPageMarkdown } from "../src/lib/markdown-pages";

/** Dev-only target of the Vite rewrite in `vite.config.ts`. */
export default async function handler(
  event: Parameters<typeof getRequestURL>[0],
) {
  const url = getRequestURL(event);
  const pathname = url.searchParams.get("pathname");

  if (!pathname) {
    return new Response("Not found", { status: 404 });
  }

  const pagePath = pageForMarkdownPath(pathname);
  const markdown =
    pagePath === null ? null : await renderPageMarkdown(pagePath, url.origin);

  if (markdown === null) {
    return (
      agentNotFoundResponse(null, url.origin, pathname) ??
      new Response("Not found", { status: 404 })
    );
  }

  return markdownResponse(markdown);
}
