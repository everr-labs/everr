import handler from "@tanstack/react-start/server-entry";
import { respond } from "./lib/agent-response";
import { markdownForPath } from "./lib/markdown-pages";
import { trailingSlashRedirect } from "./lib/trailing-slash";
import { paraglideMiddleware } from "./paraglide/server";
import { baseLocale, deLocalizeUrl, extractLocaleFromUrl } from "./paraglide/runtime";

// Gives each request its own locale, read from the URL, for the duration of the render
function render(request: Request): Promise<Response> {
  return paraglideMiddleware(request, () => handler.fetch(request));
}

export default {
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const redirect = trailingSlashRedirect(url);
    if (redirect) return Promise.resolve(redirect);
    const pathname = deLocalizeUrl(url).pathname;
    const locale = extractLocaleFromUrl(url) ?? baseLocale;
    return respond(request, pathname, {
      render,
      markdownFor: (path) => markdownForPath(path, locale),
    });
  },
};
