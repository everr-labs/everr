import { describe, expect, it } from "vitest";
import { previewNameSchema } from "./schema";

describe("previewNameSchema", () => {
  it("rejects empty, oversized, and control-character names", () => {
    expect(previewNameSchema.safeParse("").success).toBe(false);
    expect(previewNameSchema.safeParse("   ").success).toBe(false);
    expect(previewNameSchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(previewNameSchema.safeParse("a\u0000b").success).toBe(false);
    expect(previewNameSchema.safeParse("a\nb").success).toBe(false);
    // C1 control (NEL) — outside the C0/DEL range but still unsafe.
    expect(previewNameSchema.safeParse("a\u0085b").success).toBe(false);
  });
});
