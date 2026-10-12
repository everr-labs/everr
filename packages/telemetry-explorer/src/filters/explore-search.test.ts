import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ExploreSearchSchema, ExploreSearchShape } from "./explore-search";

// Layouts and page schemas must both retain absent filters, preserve explicit
// clears, and tolerate malformed links.
describe.each([
  ExploreSearchSchema,
  z.object(ExploreSearchShape),
])("shared explore filters", (schema) => {
  it("leaves absent filters undefined so navigation can retain them", () => {
    const result = schema.parse({});
    expect(result.service).toBeUndefined();
    expect(result.environment).toBeUndefined();
  });
  it("keeps selected filters and explicit clears", () => {
    expect(schema.parse({ service: ["api"], environment: [] })).toEqual({
      service: ["api"],
      environment: [],
    });
  });
  it("ignores malformed filters", () => {
    expect(schema.parse({ service: "bad" }).service).toBeUndefined();
  });
});
