import "@testing-library/jest-dom/vitest";

// jsdom lacks a few browser APIs that base-ui (popover positioning) and cmdk
// (command list highlighting) call during render. Provide noop polyfills so
// component render tests can mount these primitives.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom has no Web Animations API. Base UI's ScrollArea calls getAnimations()
// on the viewport from a timer, which throws after a test has finished.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
