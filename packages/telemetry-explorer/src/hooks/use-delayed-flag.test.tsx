import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useDelayedFlag } from "./use-delayed-flag";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("waits for the delay, resets when inactive, and waits again on reactivation", () => {
  const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 250), {
    initialProps: { active: true },
  });
  act(() => {
    vi.advanceTimersByTime(249);
  });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current).toBe(true);
  rerender({ active: false });
  expect(result.current).toBe(false);
  rerender({ active: true });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(result.current).toBe(true);
});

it("cancels pending activation when loading finishes or the consumer unmounts", () => {
  const { result, rerender, unmount } = renderHook(({ active }) => useDelayedFlag(active, 250), {
    initialProps: { active: true },
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  rerender({ active: false });
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(result.current).toBe(false);
  rerender({ active: true });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("restarts a pending delay when its duration changes", () => {
  const { result, rerender } = renderHook(({ delay }) => useDelayedFlag(true, delay), {
    initialProps: { delay: 250 },
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  rerender({ delay: 500 });
  act(() => {
    vi.advanceTimersByTime(499);
  });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current).toBe(true);
});
