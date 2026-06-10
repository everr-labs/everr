import { describe, expect, it } from "vitest";
import { computeTransition } from "./transitions";

describe("computeTransition", () => {
  it("fires from unknown or resolved on non-empty results", () => {
    expect(computeTransition("unknown", 3)).toBe("fire");
    expect(computeTransition("resolved", 1)).toBe("fire");
  });

  it("stays firing on repeated non-empty results", () => {
    expect(computeTransition("firing", 2)).toBe("still_firing");
  });

  it("resolves from firing on empty results", () => {
    expect(computeTransition("firing", 0)).toBe("resolve");
  });

  it("stays resolved on empty results when not firing", () => {
    expect(computeTransition("unknown", 0)).toBe("still_resolved");
    expect(computeTransition("resolved", 0)).toBe("still_resolved");
  });
});
