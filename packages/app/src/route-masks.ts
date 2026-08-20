import { createRouteMask } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Shared by every router built over `routeTree`, not just the one that
// navigates. On the server router-core caches the processed route tree on
// `globalThis.__TSR_CACHE__`, keyed only by route tree identity, and the first
// router to build it wins. A router built without masks leaves the mask cache
// unpopulated, so a later router that *does* set `routeMasks` inherits that
// tree and crashes in `findFlatMatch`. Every router over this tree therefore
// passes these masks, whoever gets there first.
export const routeMasks = [
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
