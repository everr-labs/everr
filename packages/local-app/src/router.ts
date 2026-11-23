import type { AssertExploreMounted } from "@everr/telemetry-explorer/explore/routes";
import { RoutePending } from "@everr/telemetry-explorer/shell";
import { createRouter } from "@tanstack/react-router";
import { localExploreBackend } from "./lib/explore-backend";
import { createQueryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
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
