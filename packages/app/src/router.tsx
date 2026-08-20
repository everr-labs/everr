import { QueryClient } from "@tanstack/react-query";
import { createRouteMask, createRouter } from "@tanstack/react-router";
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
  const queryClient = new QueryClient({
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
    context: { queryClient },
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

  registerRouter(router);
  return router;
};
