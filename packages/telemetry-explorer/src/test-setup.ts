import "@testing-library/jest-dom/vitest";
import "@everr/ui/testing/jsdom-shims";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// jsdom lacks a few browser APIs that base-ui (popover positioning) and cmdk
// (command list highlighting) call during render. Provide noop polyfills so
// component render tests can mount these primitives.
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
