import "../lib/telemetry";
import { TooltipProvider } from "@everr/ui/components/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useState } from "react";
import { AppWindow } from "../features/app-shell/app-window";
import { createQueryClient } from "../lib/query-client";
import { ReactTelemetryErrorBoundary } from "../lib/react-error-boundary";
import appCss from "../styles/local-app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Everr Local" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: Shell,
  component: Root,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

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
