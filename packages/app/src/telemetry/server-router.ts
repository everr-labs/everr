import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeMasks } from "@/route-masks";
import type { RouterContext } from "@/router";
import { routeTree } from "@/routeTree.gen";
import { type RouterLike, routeTemplate } from "./route-template";

// A standalone matcher for the server half. The app's `getRouter()` is bound
// to the per-request SSR lifecycle, so http.route derivation gets its own
// router from the same generated tree it matches against. Built on first use
// so importing this module never forces the route tree to load first.
let matcher: RouterLike | undefined;

export function serverRouteTemplate(pathname: string): string | undefined {
  matcher ??= createRouter({
    routeTree,
    // This matcher never navigates, so the masks are inert here. They are
    // passed because on the server router-core caches the processed route
    // tree globally by route tree identity, and this router is built on the
    // first request, before the SSR router. Without them the cached tree
    // reaches `getRouter()` with its mask cache unpopulated.
    routeMasks,
    history: createMemoryHistory(),
    // The matcher never loads a route, so the router context is never read.
    context: {} as RouterContext,
  });
  return routeTemplate(matcher, pathname);
}
