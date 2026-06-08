import { describe, expect, it } from "vitest";
import { dashboardSlugSchema, dashboardSpecSchema } from "./schema";

const panel = {
  kind: "Panel" as const,
  spec: {
    display: { name: "P" },
    plugin: { kind: "TimeSeriesChart", spec: {} },
  },
};

const gridItem = (ref: string) => ({
  x: 0,
  y: 0,
  width: 12,
  height: 8,
  content: { $ref: ref },
});

const spec = (ref: string) => ({
  panels: { cpu: panel },
  layouts: [{ kind: "Grid" as const, spec: { items: [gridItem(ref)] } }],
});

describe("dashboardSpecSchema layout refs", () => {
  it("accepts a ref that points at an existing panel", () => {
    expect(
      dashboardSpecSchema.safeParse(spec("#/spec/panels/cpu")).success,
    ).toBe(true);
  });

  it("rejects a ref to a non-existent panel key", () => {
    const result = dashboardSpecSchema.safeParse(spec("#/spec/panels/typo"));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(
      /does not match any panel/,
    );
  });

  it("rejects a ref that does not use the panel prefix", () => {
    const result = dashboardSpecSchema.safeParse(spec("cpu"));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/must start with/);
  });
});

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

  it("rejects empty and over-long slugs", () => {
    expect(dashboardSlugSchema.safeParse("").success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(201)).success).toBe(false);
    expect(dashboardSlugSchema.safeParse("a".repeat(200)).success).toBe(true);
  });
});
