import { describe, expect, it } from "vitest";
import { applyInput, previewNameSchema } from "./schema";

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

describe("applyInput transferFrom", () => {
  const base = {
    repoid: "github.com/acme/api",
    state: { dashboards: [], runbooks: [], alerts: [] },
  };

  it("accepts a transfer from a different repoid", () => {
    expect(
      applyInput.safeParse({ ...base, transferFrom: "legacy-uuid" }).success,
    ).toBe(true);
  });

  it("rejects a transfer from the repo's own repoid", () => {
    expect(
      applyInput.safeParse({ ...base, transferFrom: base.repoid }).success,
    ).toBe(false);
  });

  it("rejects a transfer combined with a preview apply", () => {
    expect(
      applyInput.safeParse({
        ...base,
        transferFrom: "legacy-uuid",
        preview: "gio/x",
      }).success,
    ).toBe(false);
  });
});
