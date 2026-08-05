import { setRouteResolver } from "@everr/web-sdk";

// App-owned bridge from the TanStack router to the SDK's setRouteResolver:
// telemetry init runs before the router exists, so `getRouter()` registers
// the instance here, and the SDK samples the deepest matched route id
// (e.g. `/blog/$slug`) at record time. Typed structurally to keep this
// module free of router imports.

type RouterLike = {
  state: { matches: ReadonlyArray<{ routeId: string }> };
};

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(router: RouterLike): void {
  setRouteResolver(() => {
    const matches = router.state.matches;
    return matches[matches.length - 1]?.routeId;
  });
}
