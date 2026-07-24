import { registerRouter } from "@everr/web-sdk/tanstack";
import { QueryClient } from "@tanstack/react-query";
import { createRouteMask, createRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { RootErrorComponent } from "./components/root-error";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

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
  const traceDetailModalMask = createRouteMask({
    routeTree,
    from: "/traces/$traceId/modal",
    to: "/traces/$traceId",
    params: true,
    search: true,
    unmaskOnReload: true,
  });
  const errorDetailModalMask = createRouteMask({
    routeTree,
    from: "/errors/$fingerprint/modal",
    to: "/errors/$fingerprint",
    params: true,
    search: true,
    unmaskOnReload: true,
  });

  const router = createRouter({
    routeTree,
    routeMasks: [traceDetailModalMask, errorDetailModalMask],
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
