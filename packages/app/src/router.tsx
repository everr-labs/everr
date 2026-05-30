import { QueryClient } from "@tanstack/react-query";
import {
  createRouter,
  ErrorComponent,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";
import type { EverrErrorReporterWindow } from "./telemetry/browser";

if (typeof window !== "undefined" && import.meta.env.DEV) {
  void import("./telemetry/browser");
}

function RootErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as EverrErrorReporterWindow).__everrReportError?.(error, {
      "error.source": "react.error-boundary",
    });
  }, [error]);
  return <ErrorComponent error={error} />;
}

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

  return createRouter({
    routeTree,
    context: { queryClient },
    // TODO: maybe preload?
    // defaultPreload: "intent",
    defaultErrorComponent: RootErrorComponent,
    scrollRestoration: true,
    // defaultPreloadStaleTime: 0,
    defaultPendingComponent: () => (
      <div className="flex items-center justify-center h-screen font-heading text-lg">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    ),
  });
};
