import { describe, expect, it } from "vitest";
import { dashboardModelSchema, dashboardSlugSchema } from "./schema";

const validSpec = {
  panels: {},
  layouts: [{ kind: "Grid", spec: { items: [] } }],
};

describe("dashboardSlugSchema", () => {
  it("accepts valid slugs", () => {
    expect(dashboardSlugSchema.safeParse("abc").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("a").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("my-dash-2").success).toBe(true);
    expect(dashboardSlugSchema.safeParse("xfmezad9iug4").success).toBe(true);
  });

  it("rejects uppercase and invalid characters", () => {
    expect(dashboardSlugSchema.safeParse("MyDash").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("my_dash").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("my dash").success).toBe(false);
  });

  it("rejects leading and trailing hyphens", () => {
    expect(dashboardSlugSchema.safeParse("-abc").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("abc-").success).toBe(false);
  });

  it('rejects the reserved slug "new"', () => {
    expect(dashboardSlugSchema.safeParse("new").success).toBe(false);
  });

  it("rejects empty and over-long slugs", () => {
    expect(dashboardSlugSchema.safeParse("").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(200)).success).toBe(true);
  });
});

describe("dashboardModelSchema", () => {
  it("accepts a valid full model", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "my-dash" },
      spec: validSpec,
    });
    expect(result.success).toBe(true);
  });

  it('accepts the loose draft sentinel name "new" (slug strictness is applied separately)', () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "new" },
      spec: validSpec,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a wrong kind", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Playlist",
      metadata: { name: "my-dash" },
      spec: validSpec,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing metadata name", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: {},
      spec: validSpec,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid spec", () => {
    const result = dashboardModelSchema.safeParse({
      kind: "Dashboard",
      metadata: { name: "my-dash" },
      spec: { layouts: [] }, // missing required `panels`
    });
    expect(result.success).toBe(false);
  });
});
