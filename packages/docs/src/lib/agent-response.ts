import { accepts, HTML, MARKDOWN, negotiateNotFound, negotiatePage } from "./negotiation";
import { notFoundMarkdown } from "./not-found-markdown";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

// TanStack Start's own check before it renders a page (start-server-core,
// createStartHandler): anything else gets a JSON 406. It ignores q-values and
// rejects `text/*` and `text/markdown`
const TANSTACK_RENDERS = /(^|,)\s*(\*\/\*|text\/html)/;

type Deps = {
  // The TanStack Start handler: pages, server routes and server functions
  render: (request: Request) => Promise<Response>;
  // The Markdown representation of a page, or undefined when it has none
  markdownFor: (pathname: string) => Promise<string | undefined>;
};

function isHtml(response: Response) {
  return response.headers.get("content-type")?.startsWith(HTML) ?? false;
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

// Asks TanStack Start for HTML when its check would refuse the request: negotiation is
// decided here, the render only tells whether the page exists. The new request is built
// from the URL because the node server hands over srvx's NodeRequest, which the global
// Request constructor cannot copy. GET and HEAD carry no body
function asHtmlRequest(request: Request) {
  if (TANSTACK_RENDERS.test(request.headers.get("accept") ?? "*/*")) return request;

  const headers = new Headers(request.headers);
  headers.set("accept", HTML);
  return new Request(request.url, { method: request.method, headers, signal: request.signal });
}

/**
 * Content negotiation for pages (https://acceptmarkdown.com): HTML by default,
 * Markdown when the client asks for it, 406 when it accepts neither. Every page
 * response carries `Vary: Accept` so caches keep the representations apart.
 * Missing pages answer 404 with a Markdown body agents can recover from.
 * Anything that is not an HTML page (redirects, files, JSON) passes through untouched.
 */
export async function respond(request: Request, pathname: string, deps: Deps) {
  if (request.method !== "GET" && request.method !== "HEAD") return deps.render(request);
  if (pathname.startsWith("/_serverFn") || pathname.startsWith("/api/")) {
    return deps.render(request);
  }

  const accept = request.headers.get("accept");
  const preferred = negotiatePage(accept);

  // /about/ redirects to /about: let the redirect happen rather than answer on both.
  // `pathname` has lost its trailing slash with the locale prefix, so read the URL
  const requested = new URL(request.url).pathname;
  const trailingSlash = requested.length > 1 && requested.endsWith("/");
  if (preferred === MARKDOWN && !trailingSlash) {
    const body = await deps.markdownFor(pathname);
    if (body !== undefined) return markdown(request, body);
  }

  const response = await deps.render(asHtmlRequest(request));
  if (!isHtml(response)) return response;

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
