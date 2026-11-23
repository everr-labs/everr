import {
  type AssertExploreMounted,
  errorDetailMask,
} from "@everr/telemetry-explorer/explore/routes";
import { RoutePending } from "@everr/telemetry-explorer/shell";
import { createRouteMask, createRouter } from "@tanstack/react-router";
import { localExploreBackend } from "./lib/explore-backend";
import { createQueryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

// Declared outside `createRouter` so the mask types resolve against the route
// tree rather than the router being built from them.
const routeMasks = [createRouteMask({ routeTree, ...errorDetailMask })];

export function getRouter() {
  return createRouter({
    routeTree,
    routeMasks,
    context: { queryClient: createQueryClient(), explore: localExploreBackend },
    defaultPreload: "intent",
    // A route that waits for its loader, such as a trace, shows the frame
    // with this in the page while it waits.
    defaultPendingComponent: RoutePending,
  });
}
export const router = getRouter();

// A missing Explore route file fails the type-check here, naming the path.
true satisfies AssertExploreMounted<typeof router>;

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
