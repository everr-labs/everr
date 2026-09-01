import {
  agentNotFoundResponse,
  apiError,
  jsonErrorResponse,
  markdownResponse,
} from "./agent-errors";
import { wantsMarkdownExplicitly } from "./content-negotiation";
import { renderPageMarkdown } from "./markdown-pages";
import { isKnownPagePath, normalizePagePath } from "./site-pages";

/**
 * Everything everr.dev does differently for a non-browser client, in one
 * place so it can be tested without a server.
 *
 * Returning `undefined` means "let the app handle it": the rendered page, or
 * the rendered 404. A `Response` short-circuits the request.
 */

/** Paths the app owns and the negotiation must never touch. */
const RESERVED_PREFIXES = [
  "/_serverFn",
  "/_build",
  "/assets/",
  "/everr-app/",
  "/@",
  "/__",
];

/**
 * The API routes this site actually serves. Anything else under `/api/` is a
 * dead URL, and an API client deserves a JSON error rather than a page.
 * Add new `/api` routes here when you add them under `src/routes/api`.
 */
const KNOWN_API_PREFIXES = ["/api/search", "/api/og"];

export type AgentRequest = {
  url: URL;
  method: string;
  accept: string | null;
};

export async function handleAgentRequest({
  url,
  method,
  accept,
}: AgentRequest): Promise<Response | undefined> {
  if (method !== "GET" && method !== "HEAD") return undefined;

  const siteUrl = url.origin;
  const pathname = url.pathname;

  if (RESERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return undefined;
  }

  if (pathname.startsWith("/api/") || pathname === "/api") {
    if (KNOWN_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return undefined;
    }

    return jsonErrorResponse(
      apiError(
        "not_found",
        `${pathname} is not an endpoint on everr.dev. The Everr Cloud API lives at https://app.everr.dev.`,
        404,
        siteUrl,
        `Read ${siteUrl}/openapi.json for the endpoints Everr serves.`,
      ),
    );
  }

  const markdownPath = pageForMarkdownPath(pathname);
  if (markdownPath !== null) {
    const markdown = await renderPageMarkdown(markdownPath, siteUrl);
    if (markdown === null) {
      return agentNotFoundResponse(accept, siteUrl, pathname) ?? notFound();
    }
    return markdownResponse(markdown);
  }

  // Anything else with a file extension is a static asset, not a page.
  if (hasFileExtension(pathname)) return undefined;

  if (isKnownPagePath(pathname)) {
    if (!wantsMarkdownExplicitly(accept)) return undefined;

    const markdown = await renderPageMarkdown(pathname, siteUrl);
    return markdown === null ? undefined : markdownResponse(markdown);
  }

  return agentNotFoundResponse(accept, siteUrl, pathname) ?? undefined;
}

/**
 * Maps a `.md` twin back to the page it mirrors, or `null` when the path is
 * not a Markdown request. `/docs.md` and `/index.md` name the two index pages
 * that have no slug of their own.
 */
export function pageForMarkdownPath(pathname: string): string | null {
  if (!pathname.endsWith(".md")) return null;

  const withoutSuffix = pathname.slice(0, -".md".length);
  if (withoutSuffix === "" || withoutSuffix === "/index") return "/";

  const decoded = decodePathSegments(withoutSuffix);
  if (decoded === null) return null;

  return normalizePagePath(decoded);
}

function decodePathSegments(pathname: string): string | null {
  const segments = pathname.split("/");

  try {
    const decoded = segments.map((segment, index) => {
      if (index === 0) return segment;
      const value = decodeURIComponent(segment);
      if (value === "." || value === ".." || value.includes("/")) {
        throw new Error("Invalid Markdown path segment");
      }
      return value;
    });

    return decoded.join("/");
  } catch {
    return null;
  }
}

function hasFileExtension(pathname: string): boolean {
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return lastSegment.includes(".");
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * Adds `Accept` to a rendered page's `Vary` header.
 *
 * Pages now answer differently to `Accept: text/markdown`, so a cache that
 * keyed only on the URL could hand an agent the HTML variant, or hand a
 * browser the Markdown one. Only HTML responses need it: assets and the
 * negotiated responses set their own headers.
 */
export function varyOnAccept(response: unknown): unknown {
  if (!(response instanceof Response)) return response;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/html")) return response;

  const existing = response.headers.get("vary");
  const parts = existing
    ? existing
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  if (parts.some((part) => part.toLowerCase() === "accept")) return response;

  try {
    response.headers.set("vary", [...parts, "Accept"].join(", "));
  } catch {
    // A response with immutable headers (a redirect, for example) has no body
    // to negotiate, so leaving it alone is correct.
  }

  return response;
}
