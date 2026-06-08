import { describe, expect, it } from "vitest";
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
        spec: { panels: {}, layouts: [] },
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

  it("throws with the file path when a document fails schema validation", () => {
    expect(() =>
      buildDesiredSet([
        { path: "bad.yaml", document: { kind: "Dashboard", spec: {} } },
      ]),
    ).toThrow(/bad\.yaml/);
  });
});
