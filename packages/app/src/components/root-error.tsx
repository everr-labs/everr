import { captureReactError } from "@everr/auto-otel-errors/react";
import { RetryError } from "@everr/ui/components/retry-error";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";

// The router's default error component: it catches any route render error in
// its own per-route boundary (below <Outlet />), so the browser `error`
// handlers never see these. Report them explicitly, and show a recovery UI
// instead of the router's bare stock fallback.
export function RootErrorComponent({ error }: ErrorComponentProps) {
  useEffect(() => {
    captureReactError(error);
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <RetryError
        title="Something went wrong"
        message="An unexpected error occurred. Reloading the page usually fixes it."
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
