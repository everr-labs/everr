import { setRouteResolver } from "@everr/otel-web";
import { type RouterLike, routeTemplate } from "@/telemetry/route-template";

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

/** Call this from `getRouter()` immediately after you make the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver({
    page: (url) => routeTemplate(router, new URL(url).pathname),
    // No request resolver: the client route tree has no server-only routes,
    // so url.template comes from the x-everr-route header the server echoes.
  });
}
