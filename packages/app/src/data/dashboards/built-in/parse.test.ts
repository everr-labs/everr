import { describe, expect, it } from "vite-plus/test";
import { stringify } from "yaml";
import { parseBuiltinDashboard } from "./parse";

function builtin() {
  return {
    id: "request-overview",
    name: "Request Overview",
    description: "A dashboard for requests.",
    category: "Application",
    requires: [{ signal: "traces", label: "traces" }],
    document: {
      kind: "Dashboard",
      metadata: { name: "request-overview", project: "default" },
      spec: {
        duration: "1h",
        panels: {
          requests: {
            kind: "Panel",
            spec: { plugin: { kind: "Table", spec: {} } },
          },
        },
        layouts: [
          {
            kind: "Grid",
            spec: {
              items: [
                {
                  x: 0,
                  y: 0,
                  width: 24,
                  height: 8,
                  content: { $ref: "#/spec/panels/requests" },
                },
              ],
            },
          },
        ],
      },
    },
  };
}

function parseFixture(value: Record<string, unknown>) {
  return parseBuiltinDashboard(stringify(value));
}

describe("parseBuiltinDashboard", () => {
  it("validates and normalizes a built-in dashboard resource", () => {
    const dashboard = parseFixture(builtin());

    expect(dashboard.document).toMatchObject({
      kind: "Dashboard",
      metadata: { name: "request-overview", project: "default" },
      spec: { timeRange: { from: "now-1h", to: "now" } },
    });
    expect(dashboard.document.spec).not.toHaveProperty("duration");
  });

  it("rejects invalid catalog fields", () => {
    const source = builtin();
    source.category = "Other";
    expect(() => parseFixture(source)).toThrow(/category/);
  });

  it("rejects unknown required signals", () => {
    const source = builtin();
    source.requires[0].signal = "spans";
    expect(() => parseFixture(source)).toThrow(/signal/);
  });

  it("rejects layouts that reference a missing panel", () => {
    const source = builtin();
    source.document.spec.layouts[0].spec.items[0].content.$ref = "#/spec/panels/missing";
    expect(() => parseFixture(source)).toThrow(/does not match any panel/);
  });
});
