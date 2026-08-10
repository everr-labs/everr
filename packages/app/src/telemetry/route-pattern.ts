import { setRouteResolver } from "@everr/otel-web";

// App-owned bridge from the TanStack router to the SDK's setRouteResolver:
// telemetry setup runs before the router exists, so `getRouter()` registers
// the instance here, and the SDK resolves each record's page URL to the
// deepest matching route id (e.g. `/blog/$slug`) via the router's matcher.
// Matching by URL (not the router's live state) keeps records pinned to an
// earlier page, like page_leave, on that page's route. Typed structurally
// to keep this module free of router imports.

type RouterLike = {
  matchRoutes(pathname: string): ReadonlyArray<{ routeId: string }>;
};

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver((url) => {
    const matches = router.matchRoutes(new URL(url).pathname);
    return matches[matches.length - 1]?.routeId;
  });
}
