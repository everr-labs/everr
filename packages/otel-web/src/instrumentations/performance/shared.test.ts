import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { whenIdleOrHidden } from "./shared.js";

// The jsdom environment has no requestIdleCallback. Thus the other performance
// tests examine the code that uses setTimeout. These tests replace the true idle
// API. Thus they examine the code that uses that API, and the code that operates
// when the page becomes hidden.

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
    // The code cancelled the idle request. Thus a second hidden event does not
    // call the function again.
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
