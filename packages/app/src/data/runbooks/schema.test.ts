import { describe, expect, it } from "vite-plus/test";
import { runbookSpecSchema, runbookSpecSchemaStrict } from "./schema";

const md = { inline: "# Hello" };

describe("runbookSpecSchema", () => {
  it("accepts a minimal single-document runbook", () => {
    expect(runbookSpecSchema.safeParse({ markdown: md }).success).toBe(true);
  });

  it("requires markdown (the index page)", () => {
    const r = runbookSpecSchema.safeParse({
      pages: [{ name: "a", markdown: md }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects markdown with an unresolved file pointer", () => {
    const r = runbookSpecSchema.safeParse({ markdown: { file: "./x.md" } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("everr CLI");
  });

  it("accepts recursive pages", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: md,
      pages: [
        {
          name: "triage",
          markdown: md,
          pages: [{ name: "network", markdown: md }],
        },
        { name: "rollback", display: { name: "Rollback" }, markdown: md },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate sibling page names (but allows same name in different branches)", () => {
    const dup = runbookSpecSchema.safeParse({
      markdown: md,
      pages: [
        { name: "a", markdown: md },
        { name: "a", markdown: md },
      ],
    });
    expect(dup.success).toBe(false);

    const ok = runbookSpecSchema.safeParse({
      markdown: md,
      pages: [
        { name: "x", markdown: md, pages: [{ name: "a", markdown: md }] },
        { name: "y", markdown: md, pages: [{ name: "a", markdown: md }] },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects invalid page names", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: md,
      pages: [{ name: "Not A Slug!", markdown: md }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys in markdown (catches typos like 'flie')", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: { inline: "x", flie: "y" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys on a page (catches typos like 'pagse')", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: md,
      pages: [{ name: "a", markdown: md, pagse: [{ name: "b", markdown: md }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown top-level spec keys (catches typos like 'varaibles')", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: md,
      varaibles: [{ kind: "TextVariable", spec: { name: "s", value: "v" } }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts shared panels and variables (dashboard schemas)", () => {
    const r = runbookSpecSchema.safeParse({
      markdown: md,
      variables: [{ kind: "TextVariable", spec: { name: "svc", value: "api" } }],
      panels: {
        errors: {
          kind: "Panel",
          spec: { plugin: { kind: "TimeSeriesChart", spec: {} } },
        },
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("runbookSpecSchemaStrict", () => {
  it("rejects a bad query plugin spec with path through collectPanelStrictIssues", () => {
    const r = runbookSpecSchemaStrict.safeParse({
      markdown: md,
      panels: {
        bad: {
          kind: "Panel",
          spec: {
            plugin: { kind: "TimeSeriesChart", spec: {} },
            queries: [
              {
                kind: "DataQuery",
                spec: {
                  plugin: {
                    kind: "TestData",
                    spec: {
                      scenario: "random_walk",
                      seed: "not-a-number",
                      series: [{ name: "a" }],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths.some((p) => p.startsWith("panels.bad.spec.queries.0.spec.plugin.spec"))).toBe(
      true,
    );
  });

  it("rejects an invalid panel plugin option with a precise path", () => {
    const r = runbookSpecSchemaStrict.safeParse({
      markdown: md,
      panels: {
        bad: {
          kind: "Panel",
          spec: { plugin: { kind: "TimeSeriesChart", spec: { unit: 42 } } },
        },
      },
    });
    expect(r.success).toBe(false);
    const issue = r.error?.issues[0];
    expect(issue?.path.join(".")).toBe("panels.bad.spec.plugin.spec.unit");
  });
});
