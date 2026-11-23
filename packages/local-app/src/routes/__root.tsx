import type { ShellRouterContext } from "@everr/telemetry-explorer/explore/routes";
import favicon from "@everr/ui/assets/favicon.svg?url";
import { TooltipProvider } from "@everr/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent } from "@tanstack/react-router";
import { AppWindow } from "../features/app-shell/app-window";
import { ReactTelemetryErrorBoundary } from "../lib/react-error-boundary";

export const Route = createRootRouteWithContext<ShellRouterContext>()({
  head: () => ({
    links: [{ rel: "icon", type: "image/svg+xml", href: favicon }],
  }),
  component: Root,
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <TooltipProvider>
      <HeadContent />
      <ReactTelemetryErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppWindow />
        </QueryClientProvider>
      </ReactTelemetryErrorBoundary>
    </TooltipProvider>
  );
}
