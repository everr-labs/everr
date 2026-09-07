import { describe, expect, it } from "vitest";
import {
  alertingResourceMetadataSchema,
  alertingResourceNameSchema,
} from "./schema";

// "." and ".." satisfy the character class, but they collapse away when a
// link resolves the slug against a URL: they walk up a path segment instead
// of naming a resource. Both must fail validation, although the regex alone
// would admit them.
describe("alertingResourceMetadataSchema", () => {
  it('rejects a slug of exactly "." or ".."', () => {
    expect(
      alertingResourceMetadataSchema.safeParse({ name: "." }).success,
    ).toBe(false);
    expect(
      alertingResourceMetadataSchema.safeParse({ name: ".." }).success,
    ).toBe(false);
  });

  it("still accepts a slug that merely contains dots", () => {
    expect(
      alertingResourceMetadataSchema.safeParse({ name: "v1.2.oom" }).success,
    ).toBe(true);
  });
});

describe("alertingResourceNameSchema", () => {
  it('rejects a qualified name whose slug is "." or ".."', () => {
    expect(alertingResourceNameSchema.safeParse("default/.").success).toBe(
      false,
    );
    expect(alertingResourceNameSchema.safeParse("default/..").success).toBe(
      false,
    );
  });
});
