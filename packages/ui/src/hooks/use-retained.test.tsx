import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useOverlayContent, useRetained } from "./use-retained";

describe("useRetained", () => {
  it("keeps the last value after it is cleared, and takes the next one", () => {
    const { result, rerender } = renderHook(({ value }) => useRetained(value), {
      initialProps: { value: null as string | null },
    });
    expect(result.current).toBeNull();

    rerender({ value: "a" });
    expect(result.current).toBe("a");
    rerender({ value: null });
    expect(result.current).toBe("a");
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });

  it("holds values that are functions or NaN", () => {
    const fn = () => 42;
    expect(renderHook(() => useRetained(fn)).result.current).toBe(fn);
    expect(renderHook(() => useRetained(Number.NaN)).result.current).toBeNaN();
  });
});

describe("useOverlayContent", () => {
  it("keeps the content through a close, and gives each opening a new key", () => {
    const { result, rerender } = renderHook(({ target }) => useOverlayContent(target), {
      initialProps: { target: null as string | null },
    });
    expect(result.current.open).toBe(false);

    rerender({ target: "a" });
    const first = result.current.key;
    expect(result.current).toMatchObject({ open: true, shown: "a" });
    rerender({ target: "a2" });
    expect(result.current).toMatchObject({ shown: "a2", key: first });
    rerender({ target: null });
    expect(result.current).toMatchObject({ open: false, shown: "a2", key: first });
    rerender({ target: "b" });
    expect(result.current.key).not.toBe(first);
  });
});
