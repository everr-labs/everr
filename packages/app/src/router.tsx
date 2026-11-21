import { Spinner } from "@everr/ui/components/spinner";
import { routeTree } from "@composition/routes";
import type { QueryClient } from "@tanstack/react-query";
import { createRouteMask, createRouter } from "@tanstack/react-router";
import { createQueryClient } from "#app/lib/query-client.ts";
import { dehydrateRootContext, hydrateRootContext } from "#app/lib/route-access-cache.ts";
import type { RootContext } from "#app/routes/__root.tsx";
import { registerRouter } from "#app/telemetry/route-pattern.ts";
import { panelHistoryViewTransition } from "./components/dashboards/panel-links";
import { RootErrorComponent } from "./components/root-error";

export interface RouterContext {
  queryClient: QueryClient;
}

// Declared outside `createRouter` so the mask types resolve against the route
// tree rather than the router being built from them.
const routeMasks = [
  createRouteMask({
    routeTree,
    from: "/errors/$fingerprint/modal",
    to: "/errors/$fingerprint",
    params: true,
    search: true,
    unmaskOnReload: true,
  }),
];

/**
 * The app's router, and deliberately the only `createRouter` call in it.
 *
 * Telemetry builds one of these too, to resolve `http.route`, and it must come
 * from here rather than its own `createRouter`. On the server router-core
 * caches the processed route tree on `globalThis.__TSR_CACHE__`, keyed only by
 * route tree identity and blind to the options that decide how the tree is
 * processed (`routeMasks`, `caseSensitive`). The first router built wins for
 * the whole process, so a separately configured second one inherits a tree
 * that does not match its own options and crashes in `findFlatMatch`. A single
 * call site keeps those options identical by construction.
 *
 * It passes no history: Start hands the rendering router the request's, and
 * matching needs none.
 *
 * Observed on @tanstack/react-router 1.170.23 (router-core 1.171.19); revisit
 * if the cache key learns about the options.
 */
export const getRouter = () => {
  // One per call, and Start calls this once per server request, so cached
  // session and organization data never outlives the request it was read for.
  const queryClient = createQueryClient(() => router);

  const router = createRouter({
    routeTree,
    routeMasks,
    context: { queryClient },
    dehydrate: (): { rootContext: RootContext | undefined } => ({
      rootContext: dehydrateRootContext(queryClient),
    }),
    hydrate: ({ rootContext }) => hydrateRootContext(queryClient, rootContext),
    // Captures and renders any route render error the router catches in its
    // per-route boundary (routes with their own errorComponent still win).
    defaultErrorComponent: RootErrorComponent,
    // TODO: maybe preload?
    // defaultPreload: "intent",
    // Only for navigations no link gave one: the browser's back and forward
    // between a dashboard and a maximized panel; everything else opts out.
    defaultViewTransition: panelHistoryViewTransition(),
    scrollRestoration: true,
    // A pane that scrolls itself keeps its position across navigation unless
    // it says otherwise; marking it puts the reader at the top of whatever
    // they just opened. Only when the destination has no hash to scroll to.
    scrollToTopSelectors: ["[data-scroll-to-top]"],
    // defaultPreloadStaleTime: 0,
    defaultPendingComponent: () => (
      <div className="flex items-center justify-center h-dvh font-heading text-lg">
        <Spinner className="size-5 text-primary" />
      </div>
    ),
  });

  registerRouter(router);
  return router;
};
