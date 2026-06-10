import { describe, expect, it } from "vitest";
import {
  dashboardSlugSchema,
  dashboardSpecSchema,
  dashboardSpecSchemaStrict,
} from "./schema";

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

describe("dashboardSpecSchema panel display", () => {
  it("accepts a panel that omits spec.display (Perses allows plugin+queries only)", () => {
    const noDisplay = {
      panels: {
        cpu: {
          kind: "Panel" as const,
          spec: { plugin: { kind: "TimeSeriesChart", spec: {} } },
        },
      },
      layouts: [
        {
          kind: "Grid" as const,
          spec: { items: [gridItem("#/spec/panels/cpu")] },
        },
      ],
    };
    expect(dashboardSpecSchema.safeParse(noDisplay).success).toBe(true);
  });
});

describe("dashboardSpecSchema datasources", () => {
  it("accepts a datasource without the optional `default` field (Perses parity)", () => {
    const result = dashboardSpecSchema.safeParse({
      ...spec("#/spec/panels/cpu"),
      datasources: {
        ch: { plugin: { kind: "ClickHouseDatasource", spec: {} } },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("dashboardSpecSchemaStrict plugin specs", () => {
  const specWithPlugin = (kind: string, pluginSpec: unknown) => ({
    panels: {
      cpu: {
        kind: "Panel" as const,
        spec: { plugin: { kind, spec: pluginSpec } },
      },
    },
    layouts: [
      {
        kind: "Grid" as const,
        spec: { items: [gridItem("#/spec/panels/cpu")] },
      },
    ],
  });

  it("accepts valid options for a known kind", () => {
    const result = dashboardSpecSchemaStrict.safeParse(
      specWithPlugin("TimeSeriesChart", { unit: "ms", lineWidth: 2 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an invalid option value with the full panel path", () => {
    const result = dashboardSpecSchemaStrict.safeParse(
      specWithPlugin("TimeSeriesChart", { lineWidth: "3" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      "panels",
      "cpu",
      "spec",
      "plugin",
      "spec",
      "lineWidth",
    ]);
  });

  it("rejects an out-of-enum option", () => {
    const result = dashboardSpecSchemaStrict.safeParse(
      specWithPlugin("StatChart", { calculation: "median" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts unknown option keys on a known kind (never stricter than Perses)", () => {
    const result = dashboardSpecSchemaStrict.safeParse(
      specWithPlugin("Table", { stickyHeader: true, futureOption: 1 }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts unknown plugin kinds with arbitrary specs", () => {
    const result = dashboardSpecSchemaStrict.safeParse(
      specWithPlugin("GaugeChart", { whatever: { nested: true } }),
    );
    expect(result.success).toBe(true);
  });

  it("the base schema stays lenient for the read path", () => {
    const result = dashboardSpecSchema.safeParse(
      specWithPlugin("TimeSeriesChart", { lineWidth: "3" }),
    );
    expect(result.success).toBe(true);
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
