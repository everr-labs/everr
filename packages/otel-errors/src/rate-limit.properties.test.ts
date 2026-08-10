import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

// Property tests for the rate limiter. The keys can occur in each possible
// sequence, and the clock can have each possible set of values that increase.
// In all these conditions, one key never gets more than `count` allowances in
// one window, and one key never has an effect on a different key.

const clock = fc
  .array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 200 })
  .map((deltas) => {
    let now = 0;
    return deltas.map((d) => (now += d));
  });

describe("RateLimiter", () => {
  it("never allows more than count hits inside one window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 10, max: 500 }),
        clock,
        (count, windowMs, times) => {
          const limiter = new RateLimiter(count, windowMs);
          const allowed: number[] = [];
          for (const now of times) {
            if (limiter.allow("k", now)) allowed.push(now);
          }
          // A check of the sliding window on the timestamps that the limiter
          // permitted.
          for (let i = 0; i < allowed.length; i++) {
            const inWindow = allowed.filter(
              (t) => t > allowed[i]! - windowMs && t <= allowed[i]!,
            );
            expect(inWindow.length).toBeLessThanOrEqual(count);
          }
        },
      ),
    );
  });

  it("always allows a hit once the window has fully passed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 10, max: 500 }),
        clock,
        (count, windowMs, times) => {
          const limiter = new RateLimiter(count, windowMs);
          for (const now of times) {
            limiter.allow("k", now);
          }
          const last = times[times.length - 1]!;
          expect(limiter.allow("k", last + windowMs + 1)).toBe(true);
        },
      ),
    );
  });

  it("tracks keys independently", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 10, max: 500 }),
        clock,
        fc.array(fc.constantFrom("a", "b", "c"), {
          minLength: 1,
          maxLength: 200,
        }),
        (count, windowMs, times, keys) => {
          const limiter = new RateLimiter(count, windowMs);
          const solo = new Map<string, RateLimiter>();
          for (let i = 0; i < times.length; i++) {
            const key = keys[i % keys.length]!;
            if (!solo.has(key)) solo.set(key, new RateLimiter(count, windowMs));
            expect(limiter.allow(key, times[i]!)).toBe(
              solo.get(key)!.allow(key, times[i]!),
            );
          }
        },
      ),
    );
  });
});
