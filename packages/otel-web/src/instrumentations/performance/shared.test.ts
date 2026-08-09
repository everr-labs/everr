import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenIdleOrHidden } from "./shared.js";

// jsdom has no requestIdleCallback, so the setTimeout fallback is what the
// other performance suites exercise. These tests stub the real idle API to
// cover the native path and the hidden-interrupt path.

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  setVisibility("visible");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whenIdleOrHidden", () => {
  it("runs via requestIdleCallback when the browser provides it", () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (fn: () => void) => idle.push(fn) - 1);
    vi.stubGlobal("cancelIdleCallback", () => {});
    const cb = vi.fn();
    whenIdleOrHidden(cb);
    expect(cb).not.toHaveBeenCalled();
    idle[0]();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending idle callback and runs once when the page hides", () => {
    const cancelled: number[] = [];
    vi.stubGlobal("requestIdleCallback", () => 42);
    vi.stubGlobal("cancelIdleCallback", (h: number) => cancelled.push(h));
    const cb = vi.fn();
    whenIdleOrHidden(cb);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cancelled).toEqual([42]);
    // The idle handle was cancelled; another hide never re-runs it.
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("runs at most once even when a broken cancel lets the idle fire anyway", () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (fn: () => void) => idle.push(fn) - 1);
    vi.stubGlobal("cancelIdleCallback", () => {}); // cancels nothing
    const cb = vi.fn();
    whenIdleOrHidden(cb);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    idle[0](); // the un-cancelled idle callback still fires
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("runs synchronously when the page is already hidden", () => {
    setVisibility("hidden");
    const cb = vi.fn();
    whenIdleOrHidden(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
