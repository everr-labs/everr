import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ExploreSearchRetainShape,
  ExploreSearchSchema,
} from "./explore-search";

const RetainSchema = z.object(ExploreSearchRetainShape);

describe("ExploreSearchSchema (read-friendly, used by _explore + child routes)", () => {
  it("defaults missing filters to empty arrays so consumers always get arrays", () => {
    expect(ExploreSearchSchema.parse({})).toEqual({
      service: [],
      environment: [],
    });
  });

  it("keeps provided values", () => {
    expect(
      ExploreSearchSchema.parse({ service: ["api"], environment: ["prod"] }),
    ).toEqual({ service: ["api"], environment: ["prod"] });
  });
});

describe("ExploreSearchRetainShape (used by the _dashboard layout)", () => {
  // This is the load-bearing invariant for cross-section persistence: the
  // `_dashboard` schema must NOT default service/environment. A `.default([])`
  // here makes validateSearch fill `[]` before retainSearchParams can copy the
  // real value from the current location, silently resetting the filters on a
  // sidebar click. If someone "tidies" these to `.default([])`, this fails.
  it("leaves filters UNDEFINED when absent (no default — lets retain fill them)", () => {
    const out = RetainSchema.parse({});
    expect(out.service).toBeUndefined();
    expect(out.environment).toBeUndefined();
  });

  it("keeps provided values", () => {
    expect(
      RetainSchema.parse({ service: ["api"], environment: ["prod"] }),
    ).toEqual({ service: ["api"], environment: ["prod"] });
  });

  it("tolerates a malformed value by falling back to undefined (not throwing)", () => {
    const out = RetainSchema.parse({ service: "not-an-array" });
    expect(out.service).toBeUndefined();
  });
});
