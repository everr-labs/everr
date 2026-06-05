import { type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";
import React, { type ErrorInfo, type ReactNode } from "react";

type ReactTelemetryErrorBoundaryProps = {
  children: ReactNode;
};

type ReactTelemetryErrorBoundaryState = {
  hasError: boolean;
};

export function recordReactRenderError(
  error: Error,
  errorInfo: ErrorInfo,
  logger: Logger = logs.getLogger("everr-desktop.react-errors"),
) {
  const exceptionType = error.name || "Error";
  const exceptionMessage = error.message || exceptionType;
  const attributes = {
    "exception.type": exceptionType,
    "exception.message": exceptionMessage,
    "exception.stacktrace": error.stack ?? "",
    "everr.react.component_stack": errorInfo.componentStack ?? "",
    "error.handled": true,
  } satisfies Record<string, string | boolean>;

  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: "everr.react.render.error",
    attributes,
    exception: error,
  });
}

export class ReactTelemetryErrorBoundary extends React.Component<
  ReactTelemetryErrorBoundaryProps,
  ReactTelemetryErrorBoundaryState
> {
  state: ReactTelemetryErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ReactTelemetryErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    recordReactRenderError(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-[var(--settings-shell)] text-[var(--settings-text)]">
          <section className="flex min-h-screen items-center justify-center px-6 py-14">
            <div className="grid max-w-[420px] gap-4 text-center">
              <h1 className="m-0 text-xl font-semibold">
                Something went wrong.
              </h1>
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

    return this.props.children;
  }
}
