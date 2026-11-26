import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { useZoomableProfile } from "./profile-flamegraph";

const data = {
  stacks: [{ frames: [{ name: "main", file: "", line: 0 }], value: 20_000_000 }],
  totalValue: 20_000_000,
  stackCount: 1,
};

it("stays unzoomed when a pan lands back on the whole profile", () => {
  const { result } = renderHook(() => useZoomableProfile(data, [], () => {}));
  const full = result.current.range;
  act(() => result.current.setPannedRange({ ...full }));
  expect(result.current.zoomed).toBe(false);
  act(() => result.current.setPannedRange({ start: full.start, end: full.end / 2 }));
  expect(result.current.zoomed).toBe(true);
});
