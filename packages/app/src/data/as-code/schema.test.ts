import { describe, expect, it } from "vitest";
import { applyInput, previewNameSchema } from "./schema";

const base = {
  repoid: "repo-1",
  state: { dashboards: [], runbooks: [], alerts: [] },
};

describe("previewNameSchema", () => {
  it("accepts a branch-like name and trims whitespace", () => {
    expect(previewNameSchema.parse(" gio/desktop-app ")).toBe(
      "gio/desktop-app",
    );
  });

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

describe("applyInput.preview", () => {
  it("is optional and round-trips when present", () => {
    expect(applyInput.parse(base).preview).toBeUndefined();
    expect(applyInput.parse({ ...base, preview: "gio/x" }).preview).toBe(
      "gio/x",
    );
  });

  it("rejects an invalid preview name", () => {
    expect(applyInput.safeParse({ ...base, preview: "" }).success).toBe(false);
  });
});
