import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { queryClient } from "./query-client";
import { routeTree } from "./routeTree.gen";

export interface RouterContext {
  queryClient: QueryClient;
}

export const getRouter = () => {
  return createRouter({
    routeTree,
    context: { queryClient },
    // TODO: maybe preload?
    // defaultPreload: "intent",
    scrollRestoration: true,
    // defaultPreloadStaleTime: 0,
    defaultPendingComponent: () => (
      <div className="flex items-center justify-center h-screen font-heading text-lg">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    ),
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
};
