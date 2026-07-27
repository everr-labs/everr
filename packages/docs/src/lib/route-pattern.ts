// App-owned bridge from the TanStack router to init's `routePattern`:
// telemetry init runs before the router exists, so `getRouter()` registers
// the instance and `routePattern` samples the deepest matched route id
// (e.g. `/blog/$slug`) at record time. Typed structurally to keep this
// module free of router imports.

type RouterLike = {
  state: { matches: ReadonlyArray<{ routeId: string }> };
};

let router: RouterLike | undefined;

/** Call from `getRouter()` right after creating the router. */
export function registerRouter(instance: RouterLike): void {
  router = instance;
}

/** Pass as init's `routePattern`. */
export function routePattern(): string | undefined {
  const matches = router?.state.matches;
  return matches?.[matches.length - 1]?.routeId;
}
