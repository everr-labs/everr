import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactTelemetryErrorBoundary } from "./react-error-boundary";

const telemetryMocks = vi.hoisted(() => ({
  reportRenderError: vi.fn(),
}));

vi.mock("@everr/otel-web/react", async () => {
  const React = await import("react");

  class ErrorBoundary extends React.Component<
    {
      children?: React.ReactNode;
      fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
    },
    { error: Error | null }
  > {
    state = { error: null };

    static getDerivedStateFromError(error: Error) {
      return { error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
      telemetryMocks.reportRenderError(error, errorInfo);
    }

    render() {
      if (this.state.error) {
        const { fallback } = this.props;
        return typeof fallback === "function"
          ? fallback(this.state.error)
          : (fallback ?? null);
      }

      return this.props.children;
    }
  }

  return { ErrorBoundary };
});

class ThrowsOnRender extends Error {
  name = "ThrowsOnRender";
}

function BrokenChild(): ReactNode {
  throw new ThrowsOnRender("render failed");
}

describe("ReactTelemetryErrorBoundary", () => {
  afterEach(() => {
    telemetryMocks.reportRenderError.mockReset();
    vi.restoreAllMocks();
  });

  it("renders a controlled fallback when a child render fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ReactTelemetryErrorBoundary>
        <BrokenChild />
      </ReactTelemetryErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("reports render failures through the SDK error boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ReactTelemetryErrorBoundary>
        <BrokenChild />
      </ReactTelemetryErrorBoundary>,
    );

    expect(telemetryMocks.reportRenderError).toHaveBeenCalledOnce();
    const [error, info] = telemetryMocks.reportRenderError.mock.calls[0];
    expect(error).toBeInstanceOf(ThrowsOnRender);
    expect(error.message).toBe("render failed");
    expect(info.componentStack).toContain("BrokenChild");
  });
});
