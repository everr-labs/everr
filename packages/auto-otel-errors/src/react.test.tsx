// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initClient, teardown } from "./core.js";
import { ErrorBoundary, captureReactError } from "./react.js";
import { setupTestTelemetry } from "./test-utils.js";

let otel: ReturnType<typeof setupTestTelemetry>;

beforeEach(() => {
  otel = setupTestTelemetry();
  initClient({}, "browser", []);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  teardown();
  vi.restoreAllMocks();
  await otel.dispose();
});

function Boom(): never {
  throw new Error("render boom");
}

describe("ErrorBoundary", () => {
  it("captures the error with the component stack and renders the fallback", () => {
    render(
      <ErrorBoundary fallback={<div>something broke</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("something broke")).toBeDefined();
    const [record] = otel.records();
    expect(record.attributes["exception.mechanism"]).toBe("react");
    expect(record.attributes["exception.message"]).toBe("render boom");
    expect(String(record.attributes["react.component_stack"])).toContain("Boom");
  });

  it("supports a function fallback and onError callback", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={(error) => <div>{error.message}</div>} onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("render boom")).toBeDefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("captureReactError", () => {
  it("captures with mechanism react", () => {
    captureReactError(new Error("manual react"), { componentStack: "\n at App" });
    const [record] = otel.records();
    expect(record.attributes["exception.mechanism"]).toBe("react");
    expect(record.attributes["react.component_stack"]).toBe("\n at App");
  });
});
