import { describe, expect, it } from "vitest";
import { applyInput } from "./schema";

const validState = { dashboards: [], runbooks: [], alerts: [] };

describe("applyInput repoid", () => {
  it("accepts a repository slug", () => {
    expect(
      applyInput.safeParse({ repoid: "github.com/acme/web", state: validState })
        .success,
    ).toBe(true);
  });

  // The whole `everr:ui` boundary rests on this: an apply naming a reserved
  // repoid would reconcile it, and delete-by-default would prune every
  // resource the app created there.
  it("rejects a repoid in the reserved everr: scheme", () => {
    const result = applyInput.safeParse({
      repoid: "everr:ui",
      state: validState,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("reserved");
  });

  it("rejects an empty repoid", () => {
    expect(
      applyInput.safeParse({ repoid: "", state: validState }).success,
    ).toBe(false);
  });
});
