import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useLastLoaded } from "./use-last-loaded";

const render = (values: (string | null | undefined)[], keys: string[]) =>
  renderHook(({ values, keys }) => useLastLoaded(values, keys), {
    initialProps: { values, keys },
  });

describe("useLastLoaded", () => {
  it("keeps the last value while the same key loads again", () => {
    const { result, rerender } = render(["a"], ["cpu"]);
    rerender({ values: [undefined], keys: ["cpu"] });
    expect(result.current).toEqual(["a"]);
  });

  it("drops the value when the key changes", () => {
    const { result, rerender } = render(["a"], ["cpu"]);
    rerender({ values: [undefined], keys: ["memory"] });
    expect(result.current).toEqual([undefined]);
  });

  it("treats null as loaded", () => {
    const { result, rerender } = render(["a"], ["cpu"]);
    rerender({ values: [null], keys: ["cpu"] });
    expect(result.current).toEqual([null]);
  });

  it("returns the same array while nothing changes", () => {
    const { result, rerender } = render(["a"], ["cpu"]);
    const first = result.current;
    rerender({ values: ["a"], keys: ["cpu"] });
    expect(result.current).toBe(first);
  });
});
