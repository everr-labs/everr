import { registerRouter } from "@everr/web-sdk/tanstack";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  });
  registerRouter(router);
  return router;
}
