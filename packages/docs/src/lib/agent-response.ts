import { accepts, HTML, MARKDOWN, negotiateNotFound, negotiatePage } from "./negotiation";
import { notFoundMarkdown } from "./not-found-markdown";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

type Deps = {
  // Renders the page as HTML: the TanStack Start handler
  render: (request: Request) => Promise<Response>;
  // The Markdown representation of a page, or undefined when it has none
  markdownFor: (pathname: string) => Promise<string | undefined>;
};

// Server functions, API routes and generated images answer with their own types
function isPageRequest(request: Request, pathname: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return !pathname.startsWith("/_serverFn") && !pathname.startsWith("/api/");
}

function withVaryAccept(response: Response) {
  const vary = response.headers.get("vary");
  if (vary && /(^|,)\s*(accept|\*)\s*(,|$)/i.test(vary)) return response;

  const headers = new Headers(response.headers);
  headers.set("vary", vary ? `${vary}, Accept` : "Accept");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function markdown(request: Request, body: string, status = 200) {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: { "content-type": MARKDOWN_CONTENT_TYPE, vary: "Accept" },
  });
}

function notAcceptable(request: Request, available: string[]) {
  const body = `406 Not Acceptable\n\nRequested: ${request.headers.get("accept") ?? ""}\nAvailable: ${available.join(", ")}\n`;
  return new Response(request.method === "HEAD" ? null : body, {
    status: 406,
    headers: { "content-type": "text/plain; charset=utf-8", vary: "Accept" },
  });
}

/**
 * Content negotiation for pages (https://acceptmarkdown.com): HTML by default,
 * Markdown when the client asks for it, 406 when it accepts neither. Every page
 * response carries `Vary: Accept` so caches keep the representations apart.
 * Missing pages answer 404 with a Markdown body agents can recover from.
 */
export async function respond(request: Request, pathname: string, deps: Deps) {
  if (!isPageRequest(request, pathname)) return deps.render(request);

  const accept = request.headers.get("accept");
  const preferred = negotiatePage(accept);

  if (preferred === MARKDOWN) {
    const body = await deps.markdownFor(pathname);
    if (body !== undefined) return markdown(request, body);
  }

  // Negotiation is decided above. TanStack Start's own Accept check is a regex that
  // ignores q-values and rejects `text/*` and `text/markdown` with a JSON 406, so ask
  // it for HTML and use the render only to learn whether the page exists
  // Built from the URL: the server hands over srvx's NodeRequest, which the global
  // Request constructor cannot copy. GET and HEAD carry no body
  const headers = new Headers(request.headers);
  headers.set("accept", HTML);
  const response = await deps.render(
    new Request(request.url, { method: request.method, headers, signal: request.signal }),
  );

  if (response.status === 404 && negotiateNotFound(accept) === MARKDOWN) {
    await response.body?.cancel();
    return markdown(request, notFoundMarkdown(pathname), 404);
  }

  if (response.status === 404 || accepts(accept, HTML)) return withVaryAccept(response);

  // The client accepts neither HTML nor Markdown, or only Markdown and this page has none
  await response.body?.cancel();
  const hasMarkdown = (await deps.markdownFor(pathname)) !== undefined;
  return notAcceptable(request, hasMarkdown ? [HTML, MARKDOWN] : [HTML]);
}
