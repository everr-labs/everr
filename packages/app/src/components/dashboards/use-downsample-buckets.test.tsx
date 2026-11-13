import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useDownsampleBuckets } from "./use-downsample-buckets";

describe("useDownsampleBuckets", () => {
  let resize: () => void = () => {};
  let width = 0;
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { get: () => width });
  // Stable like a real ref: a new object per render would resubscribe.
  const ref = { current: element };

  // The test setup defines ResizeObserver as writable but not configurable, so
  // it is swapped by assignment.
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.ResizeObserver = original;
  });

  it("is undefined until the observer first reports, then measures at once", () => {
    width = 640;
    const { result } = renderHook(() => useDownsampleBuckets(ref));
    expect(result.current).toBeUndefined();

    act(() => resize());
    expect(result.current).toBe(700);
  });

  it("follows a later resize only once it settles", () => {
    width = 640;
    const { result } = renderHook(() => useDownsampleBuckets(ref));
    act(() => resize());

    width = 820;
    act(() => resize());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    width = 960;
    act(() => resize());
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe(700);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(1000);
  });

  it("stays undefined without an element", () => {
    const { result } = renderHook(() => useDownsampleBuckets({ current: null }));
    expect(result.current).toBeUndefined();
  });
});
