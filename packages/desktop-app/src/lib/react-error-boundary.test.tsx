import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactTelemetryErrorBoundary } from "./react-error-boundary";

class ThrowsOnRender extends Error {
  name = "ThrowsOnRender";
}

function BrokenChild(): ReactNode {
  throw new ThrowsOnRender("render failed");
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
});
