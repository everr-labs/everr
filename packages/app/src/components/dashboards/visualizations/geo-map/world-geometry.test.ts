import { describe, expect, it } from "vite-plus/test";
import { getWorldCountries } from "./world-geometry";

describe("getWorldCountries", () => {
  it("returns a memoized list of country features with numeric ids", () => {
    const a = getWorldCountries();
    const b = getWorldCountries();
    expect(a).toBe(b); // memoized: same reference
    expect(a.length).toBeGreaterThan(100);
    const us = a.find((f) => f.id === "840");
    expect(us).toBeDefined();
    expect(us?.geometry).toBeDefined();
  });
});
