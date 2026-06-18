import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ExploreSearchRetainShape,
  ExploreSearchSchema,
} from "./explore-search";

const RetainSchema = z.object(ExploreSearchRetainShape);

describe("ExploreSearchSchema (shared by _explore + child routes)", () => {
  // Load-bearing invariant for BOTH cross-section persistence and clearable
  // filters: service/environment must NOT default to `[]`. A `.default([])`
  // makes validateSearch fill `[]` on every navigation, which (a) blocks
  // retainSearchParams from copying the real value from the current location and
  // (b) makes an explicit clear indistinguishable from a default, so a cleared
  // filter gets re-applied. Leaving them absent keeps both behaviors correct;
  // read sites coalesce with `?? []`. If someone "tidies" these back to
  // `.default([])`, this fails.
  it("leaves missing filters UNDEFINED (no default — keeps them clearable + retainable)", () => {
    const out = ExploreSearchSchema.parse({});
    expect(out.service).toBeUndefined();
    expect(out.environment).toBeUndefined();
  });

  it("keeps provided values", () => {
    expect(
      ExploreSearchSchema.parse({ service: ["api"], environment: ["prod"] }),
    ).toEqual({ service: ["api"], environment: ["prod"] });
  });
});

describe("ExploreSearchRetainShape (used by the _dashboard layout)", () => {
  // Same shape as ExploreSearchShape (re-exported alias) — the _dashboard layout,
  // where retainSearchParams runs for the sidebar, depends on the absent-not-empty
  // behavior just like the explore routes do.
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
