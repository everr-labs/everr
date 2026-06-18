import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to count emissions per key per window", () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.allow("k", 0)).toBe(true);
    expect(limiter.allow("k", 10)).toBe(true);
    expect(limiter.allow("k", 20)).toBe(true);
    expect(limiter.allow("k", 30)).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
  });

  it("allows again once the window slides past old hits", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow("k", 0)).toBe(true);
    expect(limiter.allow("k", 100)).toBe(true);
    expect(limiter.allow("k", 500)).toBe(false);
    expect(limiter.allow("k", 1101)).toBe(true);
  });
});
