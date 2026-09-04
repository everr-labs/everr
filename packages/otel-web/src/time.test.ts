import { afterEach, expect, it, vi } from "vitest";
import { epoch } from "./time.js";

afterEach(() => vi.unstubAllGlobals());

it("converts a browser timestamp to integer epoch milliseconds", () => {
  vi.stubGlobal("performance", { timeOrigin: 1_700_000_000_000 });

  expect(epoch(120.5)).toBe(1_700_000_000_121);
});
