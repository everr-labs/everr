import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindEmit } from "./current.js";
import type { Emit } from "./emitter.js";
import { ErrorBoundary } from "./react.js";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function Bomb(): never {
  throw new Error("render boom");
}

let emit: ReturnType<typeof vi.fn>;
let stopErrors: () => void;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  emit = vi.fn();
  stopErrors = bindEmit(emit as unknown as Emit);
  // React writes a render error that it catches with console.error. This code
  // keeps the output of the test clear.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopErrors();
  vi.restoreAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function render(node: Parameters<ReturnType<typeof createRoot>["render"]>[0]) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

describe("ErrorBoundary", () => {
  it("renders children while nothing throws", () => {
    const host = render(
      createElement(ErrorBoundary, null, createElement("p", null, "fine")),
    );
    expect(host.textContent).toBe("fine");
    expect(emit).not.toHaveBeenCalled();
  });

  it("swaps to the fallback and reports the render error", () => {
    const host = render(
      createElement(
        ErrorBoundary,
        { fallback: createElement("p", null, "broken") },
        createElement(Bomb),
      ),
    );
    expect(host.textContent).toBe("broken");
    expect(emit).toHaveBeenCalledWith(
      "exception",
      expect.objectContaining({
        "exception.message": "render boom",
        "everr.error.mechanism": "react",
        "everr.react.component_stack": expect.stringContaining("Bomb"),
      }),
      17,
      "Error: render boom",
    );
  });

  it("passes the thrown value to a function fallback", () => {
    const host = render(
      createElement(
        ErrorBoundary,
        { fallback: (error: unknown) => String((error as Error).message) },
        createElement(Bomb),
      ),
    );
    expect(host.textContent).toBe("render boom");
  });

  it("renders nothing after an error without a fallback", () => {
    const host = render(
      createElement(ErrorBoundary, null, createElement(Bomb)),
    );
    expect(host.textContent).toBe("");
  });
});
