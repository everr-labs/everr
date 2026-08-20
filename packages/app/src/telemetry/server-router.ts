import { getRouter } from "@/router";
import { type RouterLike, routeTemplate } from "./route-template";

// A standalone matcher for the server half. The rendering router does not
// exist yet when `instrumentServerFetch` needs `http.route`: Start builds it
// lazily inside the request handler we wrap, and binds it to that request's
// history. So http.route derivation gets its own router, from the same
// factory so the two agree on how the route tree is processed (see
// `GetRouterOptions.forRouteMatchingOnly`). Built on first use so importing
// this module never forces the route tree to load first.
let matcher: RouterLike | undefined;

export function serverRouteTemplate(pathname: string): string | undefined {
  matcher ??= getRouter({ forRouteMatchingOnly: true });
  return routeTemplate(matcher, pathname);
}
