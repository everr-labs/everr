import {
  JSON_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  negotiateMediaType,
  VARY_ACCEPT,
} from "./content-negotiation";

/**
 * The error bodies everr.dev hands to non-browser clients.
 *
 * A browser still gets the rendered 404 page. Anything that asks for JSON gets
 * a structured body with a stable `code`; anything else gets a short Markdown
 * body that names the machine-readable entry points, so an agent that lands on
 * a dead URL can recover in one more request instead of guessing.
 */

export type ApiErrorCode =
  | "not_found"
  | "not_acceptable"
  | "method_not_allowed"
  | "internal_error";

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  status: number;
  documentation_url: string;
  hint: string;
};

/** The files an agent should read next, whatever went wrong. */
function entryPoints(siteUrl: string) {
  return [
    { path: "/llms.txt", label: "What Everr is and when to use it" },
    { path: "/sitemap.xml", label: "Every indexable URL" },
    { path: "/openapi.json", label: "The Everr Cloud API description" },
    { path: "/docs", label: "Documentation index" },
    { path: "/docs.md", label: "Documentation index as Markdown" },
  ].map((entry) => ({ ...entry, url: `${siteUrl}${entry.path}` }));
}

export function notFoundMarkdown(siteUrl: string, pathname: string): string {
  const links = entryPoints(siteUrl)
    .map((entry) => `- [${entry.path}](${entry.url}): ${entry.label}`)
    .join("\n");

  return [
    "# 404 Not Found",
    "",
    `\`${pathname}\` does not exist on everr.dev.`,
    "",
    "## Where to look next",
    "",
    links,
    "",
    "Any documentation page also answers to `Accept: text/markdown`, and every",
    "page under `/docs` has a Markdown twin at the same path plus `.md`.",
    "",
  ].join("\n");
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  siteUrl: string,
  hint: string,
): ApiError {
  return {
    code,
    message,
    status,
    documentation_url: `${siteUrl}/docs`,
    hint,
  };
}

export function jsonErrorResponse(error: ApiError): Response {
  return new Response(JSON.stringify({ error }, null, 2), {
    status: error.status,
    headers: {
      "content-type": JSON_CONTENT_TYPE,
      vary: VARY_ACCEPT,
    },
  });
}

export function markdownResponse(markdown: string, status = 200): Response {
  return new Response(markdown, {
    status,
    headers: {
      "content-type": MARKDOWN_CONTENT_TYPE,
      vary: VARY_ACCEPT,
    },
  });
}

/**
 * The 404 for a client that is not a browser. Returns `null` when the client
 * accepts HTML, which means the request should fall through to the rendered
 * 404 page.
 */
export function agentNotFoundResponse(
  accept: string | null,
  siteUrl: string,
  pathname: string,
): Response | null {
  const negotiated = negotiateMediaType(accept);

  if (negotiated === "html") return null;

  if (negotiated === "json") {
    return jsonErrorResponse(
      apiError(
        "not_found",
        `${pathname} does not exist on everr.dev.`,
        404,
        siteUrl,
        `Read ${siteUrl}/llms.txt for the site map and ${siteUrl}/openapi.json for the API.`,
      ),
    );
  }

  if (negotiated === "unacceptable") {
    return jsonErrorResponse(
      apiError(
        "not_acceptable",
        "everr.dev serves text/html, text/markdown and application/json.",
        406,
        siteUrl,
        "Send Accept: text/markdown for the Markdown form of a page.",
      ),
    );
  }

  return markdownResponse(notFoundMarkdown(siteUrl, pathname), 404);
}
