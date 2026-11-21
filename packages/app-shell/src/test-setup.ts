import "@testing-library/jest-dom/vitest";
import "@everr/ui/testing/jsdom-shims";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// jsdom lacks ResizeObserver, which base-ui (popover positioning) calls during
// render.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
