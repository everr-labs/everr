// TanStack Router adapter: bridges the router's matched route into init's
// `routePattern` option. The router is typed structurally so the SDK takes
// no TanStack dependency, and the subpath entry ships zero bytes to
// non-TanStack adopters. Wiring is two one-liners per app: `registerRouter`
// where the router is created, `routePattern` passed to init.

type TanStackRouterLike = {
  state: { matches: ReadonlyArray<{ routeId: string }> };
};

let router: TanStackRouterLike | undefined;

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(instance: TanStackRouterLike): void {
  router = instance;
}

/**
 * Pass as init's `routePattern`: samples the deepest matched route id (e.g.
 * `/blog/$slug`) at record time.
 */
export function routePattern(): string | undefined {
  const matches = router?.state.matches;
  return matches?.[matches.length - 1]?.routeId;
}
