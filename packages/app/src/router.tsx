import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouteMask,
  createRouter,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { registerRouter } from "@/telemetry/route-pattern";
import { RootErrorComponent } from "./components/root-error";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

// Declared outside `createRouter` so the mask types resolve against the route
// tree rather than the router being built from them.
const routeMasks = [
  createRouteMask({
    routeTree,
    from: "/traces/$traceId/modal",
    to: "/traces/$traceId",
    params: true,
    search: true,
    unmaskOnReload: true,
  }),
  createRouteMask({
    routeTree,
    from: "/errors/$fingerprint/modal",
    to: "/errors/$fingerprint",
    params: true,
    search: true,
    unmaskOnReload: true,
  }),
];

export interface GetRouterOptions {
  /**
   * Build a router that only answers `matchRoutes`, for deriving `http.route`.
   * It skips the query client and the telemetry registration, both of which
   * belong to the router that actually renders.
   *
   * Route matching still goes through this one factory because the server
   * caches the processed route tree on `globalThis.__TSR_CACHE__`, keyed only
   * by route tree identity and blind to the options that decide how the tree
   * is processed (`routeMasks` and `caseSensitive`). The first router built
   * over the tree wins for the whole process, so a second router configured
   * differently would inherit a tree that does not match its own options and
   * crash in `findFlatMatch`. One factory keeps those options identical by
   * construction.
   */
  forRouteMatchingOnly?: boolean;
}

export const getRouter = ({
  forRouteMatchingOnly = false,
}: GetRouterOptions = {}) => {
  const queryClient = forRouteMatchingOnly
    ? undefined
    : new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: 3,
          },
        },
      });

  const router = createRouter({
    routeTree,
    routeMasks,
    // A matcher never navigates, so it gets an inert history rather than the
    // per-request one Start assigns to the rendering router.
    ...(forRouteMatchingOnly ? { history: createMemoryHistory() } : {}),
    // The matcher never loads a route, so its context is never read.
    context: { queryClient } as RouterContext,
    // Captures and renders any route render error the router catches in its
    // per-route boundary (routes with their own errorComponent still win).
    defaultErrorComponent: RootErrorComponent,
    // TODO: maybe preload?
    // defaultPreload: "intent",
    scrollRestoration: true,
    // defaultPreloadStaleTime: 0,
    defaultPendingComponent: () => (
      <div className="flex items-center justify-center h-screen font-heading text-lg">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    ),
  });

  // The telemetry SDK holds one global resolver, so only the rendering router
  // claims it.
  if (!forRouteMatchingOnly) registerRouter(router);
  return router;
};
