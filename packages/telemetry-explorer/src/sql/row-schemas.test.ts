import { describe, expect, it } from "vite-plus/test";
import {
  SqlAttributesSchema,
  SqlCountSchema,
  SqlTimestampSchema,
  SqlUnsignedIntegerTextSchema,
} from "./row-schemas";

describe("SQL wire values", () => {
  it.each([
    "2026-10-21 10:11:12",
    "2026-10-21 10:11:12.123456789",
    "2026-10-21T10:11:12.123456789Z",
    "2026-10-21T10:11:12.123456789+01:00",
    "2026-10-21T10:11:12+0100",
    "2026-10-21t10:11:12z",
  ])("preserves valid timestamps without truncating precision: %s", (timestamp) => {
    expect(SqlTimestampSchema.parse(timestamp)).toBe(timestamp);
  });

  it.each(["", "not-a-date", "2026-13-21 10:11:12", "2026-02-30 10:11:12", null, 42])(
    "rejects invalid timestamps: %j",
    (timestamp) => {
      expect(SqlTimestampSchema.safeParse(timestamp).success).toBe(false);
    },
  );

  it.each([0, 42, "0", "42", "18446744073709551615"])(
    "accepts numeric and quoted counts without coercion: %j",
    (count) => {
      expect(SqlCountSchema.parse(count)).toBe(count);
    },
  );

  it.each(["", " ", "NaN", "Infinity", "12foo", "-1", "1.5", -1, 1.5, NaN, Infinity, null, true])(
    "rejects invalid counts before Number() can hide them: %j",
    (count) => {
      expect(SqlCountSchema.safeParse(count).success).toBe(false);
    },
  );

  it("preserves full UInt64 text and nested dynamic attributes", () => {
    const max = "18446744073709551615";
    expect(SqlUnsignedIntegerTextSchema.parse(max)).toBe(max);
    const attributes = { nested: { count: max, values: [null, true, 0, "safe"] } };
    expect(SqlAttributesSchema.parse(attributes)).toEqual(attributes);
    expect(SqlAttributesSchema.parse(null)).toBeNull();
    expect(SqlAttributesSchema.parse(undefined)).toBeUndefined();
  });
});
