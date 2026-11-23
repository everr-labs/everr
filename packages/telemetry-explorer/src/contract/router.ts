import { createMemoryHistory, createRouteMask, createRouter } from "@tanstack/react-router";
import {
  type AssertExploreMounted,
  errorDetailMask,
  type ShellRouterContext,
} from "../explore/routes";
import { routeTree } from "./routeTree.gen";

const routeMasks = [createRouteMask({ routeTree, ...errorDetailMask })];

/**
 * The package's own router, over the routes the shared code links to and reads
 * (`contract/routes`). Only this package's type-check and tests include it: it
 * registers the route tree the shared code is checked against, so a link from
 * shared code to a path that only one app has does not compile here. It is also
 * the router the tests render.
 */
export function createContractRouter(initialEntry: string, context: ShellRouterContext) {
  return createRouter({
    routeTree,
    routeMasks,
    context,
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

true satisfies AssertExploreMounted<ReturnType<typeof createContractRouter>>;

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createContractRouter>;
  }
}
