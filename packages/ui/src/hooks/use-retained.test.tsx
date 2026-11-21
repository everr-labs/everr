import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useOpenCount, useRetained } from "./use-retained";

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
});

describe("useOpenCount", () => {
  it("counts each opening, and holds through a close", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenCount(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(0);

    rerender({ open: true });
    expect(result.current).toBe(1);
    rerender({ open: false });
    expect(result.current).toBe(1);
    rerender({ open: true });
    expect(result.current).toBe(2);
  });
});
