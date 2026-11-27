import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useNow } from "./use-now";

afterEach(() => {
  vi.useRealTimers();
});

it("moves on every interval while it is read", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { result } = renderHook(() => useNow(1_000));
  expect(result.current).toBe(0);

  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current).toBe(1_000);
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current).toBe(2_000);
});

it("reads the clock again when it mounts after a while unwatched", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  renderHook(() => useNow(5_000)).unmount();

  vi.setSystemTime(60_000);
  expect(renderHook(() => useNow(5_000)).result.current).toBe(60_000);
});
