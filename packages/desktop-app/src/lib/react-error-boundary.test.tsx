import type { Logger } from "@opentelemetry/api-logs";
import { render, screen } from "@testing-library/react";
import type { ErrorInfo, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReactTelemetryErrorBoundary,
  recordReactRenderError,
} from "./react-error-boundary";

class ThrowsOnRender extends Error {
  name = "ThrowsOnRender";
}

function BrokenChild(): ReactNode {
  throw new ThrowsOnRender("render failed");
}

function createLoggerHarness() {
  const logger = {
    emit: vi.fn(),
  };

  return {
    logger: logger as unknown as Logger,
    loggerMocks: logger,
  };
}

describe("ReactTelemetryErrorBoundary", () => {
  afterEach(() => {
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

  it("records React render errors as logs without props or state", () => {
    const { logger, loggerMocks } = createLoggerHarness();
    const error = new ThrowsOnRender("render failed");
    const info = {
      componentStack: "\n    at BrokenChild\n    at TestApp",
    } satisfies ErrorInfo;

    recordReactRenderError(error, info, logger);

    expect(loggerMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "ERROR",
        body: "everr.react.render.error",
        attributes: expect.objectContaining({
          "exception.type": "ThrowsOnRender",
          "exception.message": "render failed",
          "everr.react.component_stack": info.componentStack,
          "error.handled": true,
        }),
        exception: error,
      }),
    );
    expect(loggerMocks.emit.mock.calls[0]?.[0].attributes).not.toHaveProperty(
      "react.props",
    );
    expect(loggerMocks.emit.mock.calls[0]?.[0].attributes).not.toHaveProperty(
      "react.state",
    );
  });
});
