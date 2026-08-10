import { setRouteResolver } from "@everr/otel-web";

// The connection from the TanStack router to the setRouteResolver function of
// the SDK. This app owns this module. The telemetry setup operates before the
// router exists. Thus `getRouter()` registers the router here. Then the SDK uses
// the matcher of the router to change the page URL of each record into the
// deepest route id that agrees, for example `/blog/$slug`.
//
// The code matches the URL, and it does not read the current state of the
// router. Thus a record for a previous page, for example page_leave, keeps the
// route of that page. The types here give only the structure. Thus this module
// imports nothing from the router.

type RouterLike = {
  matchRoutes(pathname: string): ReadonlyArray<{ routeId: string }>;
};

/** Call this from `getRouter()` immediately after you make the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver((url) => {
    const matches = router.matchRoutes(new URL(url).pathname);
    return matches[matches.length - 1]?.routeId;
  });
}
