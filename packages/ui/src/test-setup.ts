import "@testing-library/jest-dom/vitest";

// jsdom has no Web Animations API. Base UI's ScrollArea calls getAnimations()
// on the viewport from a timer, which throws after a test has finished.
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
