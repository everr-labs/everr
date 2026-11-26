import handler from "@tanstack/react-start/server-entry";
import { respond } from "./lib/agent-response";
import { markdownForPath } from "./lib/markdown-pages";
import { paraglideMiddleware } from "./paraglide/server";
import { baseLocale, deLocalizeUrl, extractLocaleFromUrl } from "./paraglide/runtime";

// Gives each request its own locale, read from the URL, for the duration of the render
function render(request: Request): Promise<Response> {
  return paraglideMiddleware(request, () => handler.fetch(request));
}

export default {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The router would redirect this too, but always with a temporary 307. Leading slashes
    // collapse to one: "//host" in a Location header is another site
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      const location = `/${url.pathname.replace(/^\/+|\/+$/g, "")}${url.search}`;
      return Promise.resolve(new Response(null, { status: 308, headers: { location } }));
    }
    const pathname = deLocalizeUrl(url).pathname;
    const locale = extractLocaleFromUrl(url) ?? baseLocale;
    return respond(request, pathname, {
      render,
      markdownFor: (path) => markdownForPath(path, locale),
    });
  },
};
