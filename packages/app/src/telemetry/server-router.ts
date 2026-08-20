import { getRouter } from "@/router";
import { type RouterLike, routeTemplate } from "./route-template";

// The rendering router does not exist yet when `instrumentServerFetch` needs
// `http.route`: Start builds it lazily inside the handler we wrap, bound to
// that request's history. So matching gets its own router, from the same
// factory for the reason documented on `getRouter`. One per process.
let matcher: RouterLike | undefined;

export function serverRouteTemplate(pathname: string): string | undefined {
  matcher ??= getRouter({ forRouteMatchingOnly: true });
  return routeTemplate(matcher, pathname);
}
