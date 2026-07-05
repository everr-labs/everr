import "@testing-library/jest-dom/vitest";

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
