import { describe, expect, it } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";
import { buildDesiredSet } from "./desired";

const doc = (name?: string) => ({
  kind: "Dashboard",
  ...(name ? { metadata: { name } } : {}),
  spec: { panels: {}, layouts: [] },
});

describe("buildDesiredSet", () => {
  it("derives folderPath, slug, and the default project", () => {
    const set = buildDesiredSet([
      {
        path: "platform/latency/overview.yaml",
        document: doc("latency-overview"),
      },
    ]);
    expect(set).toEqual([
      {
        project: "default",
        slug: "latency-overview",
        folderPath: "platform / latency",
        document: doc("latency-overview"),
      },
    ]);
  });

  it("reads metadata.project when present", () => {
    const set = buildDesiredSet([
      {
        path: "cpu.yaml",
        document: {
          kind: "Dashboard",
          metadata: { name: "cpu", project: "platform" },
          spec: { panels: {}, layouts: [] },
        },
      },
    ]);
    expect(set[0]?.project).toBe("platform");
  });

  it("rejects an invalid project name", () => {
    const input = [
      {
        path: "cpu.yaml",
        document: {
          kind: "Dashboard",
          metadata: { name: "cpu", project: "Not Valid" },
          spec: { panels: {}, layouts: [] },
        },
      },
    ];
    expect(() => buildDesiredSet(input)).toThrow(ApplyValidationError);
    expect(() => buildDesiredSet(input)).toThrow(
      /invalid project "Not Valid"/i,
    );
  });

  it("rejects an invalid plugin option, naming the file and the option path", () => {
    const input = [
      {
        path: "team/cpu.yaml",
        document: {
          kind: "Dashboard",
          metadata: { name: "cpu" },
          spec: {
            panels: {
              cpu: {
                kind: "Panel",
                spec: {
                  plugin: { kind: "TimeSeriesChart", spec: { lineWidth: "3" } },
                },
              },
            },
            layouts: [],
          },
        },
      },
    ];
    expect(() => buildDesiredSet(input)).toThrow(ApplyValidationError);
    expect(() => buildDesiredSet(input)).toThrow(
      /team\/cpu\.yaml: invalid dashboard spec at panels\.cpu\.spec\.plugin\.spec\.lineWidth/,
    );
  });

  it("allows the same slug in different projects, rejects a duplicate within one project", () => {
    const a = {
      kind: "Dashboard",
      metadata: { name: "dup", project: "team-a" },
      spec: { panels: {}, layouts: [] },
    };
    const b = {
      kind: "Dashboard",
      metadata: { name: "dup", project: "team-b" },
      spec: { panels: {}, layouts: [] },
    };
    expect(
      buildDesiredSet([
        { path: "a.yaml", document: a },
        { path: "b.yaml", document: b },
      ]),
    ).toHaveLength(2);

    expect(() =>
      buildDesiredSet([
        { path: "a.yaml", document: a },
        { path: "b.yaml", document: a },
      ]),
    ).toThrow(/duplicate dashboard "dup" in project "team-a"/i);
  });

  it("falls back to the filename (sans extension) when metadata.name is absent", () => {
    const set = buildDesiredSet([{ path: "overview.json", document: doc() }]);
    expect(set[0]?.slug).toBe("overview");
    expect(set[0]?.folderPath).toBe("");
  });

  it("ignores a leading ./ in the path when deriving folderPath", () => {
    const set = buildDesiredSet([
      {
        path: "./platform/cpu.yaml",
        document: {
          kind: "Dashboard",
          metadata: { name: "cpu" },
          spec: { panels: {}, layouts: [] },
        },
      },
    ]);
    expect(set[0]?.folderPath).toBe("platform");
  });

  it("stores the whole document verbatim, including unknown top-level fields", () => {
    const document = {
      kind: "Dashboard",
      metadata: { name: "cpu", labels: { team: "platform" } },
      spec: { panels: {}, layouts: [] },
      apiVersion: "perses.dev/v1",
    };
    const set = buildDesiredSet([{ path: "cpu.yaml", document }]);
    expect(set[0]?.document).toEqual(document);
  });

  it("throws a typed ApplyValidationError (→ HTTP 400) with the file path on a bad spec", () => {
    expect(() =>
      buildDesiredSet([
        { path: "bad.yaml", document: { kind: "Dashboard", spec: {} } },
      ]),
    ).toThrow(ApplyValidationError);
    expect(() =>
      buildDesiredSet([
        { path: "bad.yaml", document: { kind: "Dashboard", spec: {} } },
      ]),
    ).toThrow(/bad\.yaml/);
  });
});
