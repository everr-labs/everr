import { ErrorBoundary } from "@everr/otel-web/react";
import type { ReactNode } from "react";

function ErrorFallback() {
  return (
    <main className="min-h-screen bg-[var(--settings-shell)] text-[var(--settings-text)]">
      <section className="flex min-h-screen items-center justify-center px-6 py-14">
        <div className="grid max-w-[420px] gap-4 text-center">
          <h1 className="m-0 text-xl font-semibold">Something went wrong.</h1>
          <button
            type="button"
            className="mx-auto rounded border border-[color:var(--settings-border)] bg-[var(--settings-panel)] px-3 py-2 text-sm font-medium text-[var(--settings-text)]"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </section>
    </main>
  );
}

// The library's ErrorBoundary calls captureReactError in componentDidCatch,
// emitting a "react" mechanism error log with the component stack attached.
export function ReactTelemetryErrorBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return <ErrorBoundary fallback={<ErrorFallback />}>{children}</ErrorBoundary>;
}
