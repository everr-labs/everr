import { describe, expect, it } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";
import { buildDesiredSet } from "./desired";

const doc = (name?: string) => ({
  kind: "Dashboard",
  ...(name ? { metadata: { name } } : {}),
  spec: { panels: {}, layouts: [] },
});

describe("buildDesiredSet", () => {
  it("derives folderPath from directories and slug from metadata.name", () => {
    const set = buildDesiredSet([
      {
        path: "platform/latency/overview.yaml",
        document: doc("latency-overview"),
      },
    ]);
    expect(set).toEqual([
      {
        slug: "latency-overview",
        folderPath: "platform / latency",
        document: doc("latency-overview"),
      },
    ]);
  });

  it("falls back to the filename (sans extension) when metadata.name is absent", () => {
    const set = buildDesiredSet([{ path: "overview.json", document: doc() }]);
    expect(set[0]?.slug).toBe("overview");
    expect(set[0]?.folderPath).toBe("");
  });

  it("throws on a duplicate slug within the source", () => {
    expect(() =>
      buildDesiredSet([
        { path: "a/x.yaml", document: doc("dup") },
        { path: "b/y.yaml", document: doc("dup") },
      ]),
    ).toThrow(/duplicate dashboard "dup"/i);
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
