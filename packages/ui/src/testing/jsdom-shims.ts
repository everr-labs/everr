// Browser APIs that jsdom does not implement but @everr/ui components call.
// Imported for its side effects from every package's vitest setup file, so the
// package that owns the components also owns the shims they need.

// Base UI's ScrollArea calls getAnimations() on the viewport from a timer,
// which throws after a test has finished.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}
