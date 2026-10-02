import { TooltipProvider } from "@everr/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppWindow } from "../features/app-shell/app-window";
import { createQueryClient } from "../lib/query-client";
import { ReactTelemetryErrorBoundary } from "../lib/react-error-boundary";

export const Route = createRootRoute({
  component: Root,
});

function Root() {
  const [queryClient] = useState(createQueryClient);
  return (
    <TooltipProvider>
      <ReactTelemetryErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppWindow />
        </QueryClientProvider>
      </ReactTelemetryErrorBoundary>
    </TooltipProvider>
  );
}
