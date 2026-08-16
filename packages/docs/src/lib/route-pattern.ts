import { setRouteResolver } from "@everr/otel-web";

// The connection from the TanStack router to the setRouteResolver function of
// the SDK. This site owns this module. The telemetry construction operates
// before the router exists. Thus `getRouter()` registers the router here. Then
// the SDK uses the matcher of the router to change the page URL of each record
// into the template of the deepest route that agrees, for example
// `/blog/$slug`.
//
// The code matches the URL, and it does not read the current state of the
// router. Thus a record for a previous page, for example page_leave, keeps the
// route of that page. The types here give only the structure. Thus this module
// imports nothing from the router.

type RouterLike = {
  matchRoutes(
    pathname: string,
  ): ReadonlyArray<{ routeId: string; fullPath: string }>;
};

/** Call this from `getRouter()` immediately after you make the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver({
    page: (url) => {
      const match = router.matchRoutes(new URL(url).pathname).at(-1);
      // matchRoutes falls through to the root match on unknown paths; an
      // unmatched page has no pattern rather than a fake one. The fullPath
      // keeps pathless layout segments out of the pattern.
      return match === undefined || match.routeId === "__root__"
        ? undefined
        : match.fullPath;
    },
  });
}
