import { ErrorBoundary } from "@everr/otel-web/react";
import { Button } from "@everr/ui/components/button";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@everr/ui/components/empty";
import type { ReactNode } from "react";

function ErrorFallback() {
  return (
    <main className="bg-background text-foreground flex min-h-screen">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyTitle as="h2">Something went wrong.</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  );
}

// The library's ErrorBoundary reports in componentDidCatch, emitting a
// "react" mechanism error log with the component stack attached.
export function ReactTelemetryErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<ErrorFallback />}>{children}</ErrorBoundary>;
}
