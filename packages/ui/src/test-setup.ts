import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lacks the layout APIs cmdk and Base UI poke at. Component tests opt
// into jsdom per file (`@vitest-environment jsdom`); lib tests stay on node,
// where these guards are all no-ops.
if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    writable: true,
    value() {},
  });
}

afterEach(() => {
  cleanup();
});
