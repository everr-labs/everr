import { describe, expect, it } from "vitest";
import {
  diffInstances,
  extractInstanceLabels,
  instanceFingerprint,
  rowsToInstances,
} from "./instances";

describe("extractInstanceLabels", () => {
  it("uses string columns implicitly", () => {
    expect(
      extractInstanceLabels(
        { route: "/x", error_count: 7, ok: true, n: null },
        [],
      ),
    ).toEqual({ route: "/x" });
  });

  it("uses explicit columns and stringifies values", () => {
    expect(
      extractInstanceLabels({ route: "/x", code: 500 }, ["route", "code"]),
    ).toEqual({ route: "/x", code: "500" });
  });

  it("maps absent explicit columns to empty string", () => {
    expect(extractInstanceLabels({ route: "/x" }, ["zone"])).toEqual({
      zone: "",
    });
  });

  it("returns empty labels for rows with no string columns", () => {
    expect(extractInstanceLabels({ error_count: 7 }, [])).toEqual({});
  });
});

describe("instanceFingerprint", () => {
  it("is order independent and stable", () => {
    const a = instanceFingerprint({ a: "1", b: "2" });
    const b = instanceFingerprint({ b: "2", a: "1" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs for different labels", () => {
    expect(instanceFingerprint({ a: "1" })).not.toBe(
      instanceFingerprint({ a: "2" }),
    );
    expect(instanceFingerprint({})).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("rowsToInstances", () => {
  it("keeps the first row per fingerprint", () => {
    const instances = rowsToInstances(
      [
        { route: "/x", error_count: 9 },
        { route: "/x", error_count: 3 },
        { route: "/y", error_count: 1 },
      ],
      [],
    );
    expect(instances).toHaveLength(2);
    expect(instances[0].labels).toEqual({ route: "/x" });
    expect(instances[0].row).toEqual({ route: "/x", error_count: 9 });
  });
});

describe("diffInstances", () => {
  const inst = (route: string) => {
    const labels = { route };
    return { fingerprint: instanceFingerprint(labels), labels, row: { route } };
  };

  it("computes newlyFired and nowResolved", () => {
    const prevX = {
      fingerprint: instanceFingerprint({ route: "/x" }),
      labels: { route: "/x" },
    };
    const prevZ = {
      fingerprint: instanceFingerprint({ route: "/z" }),
      labels: { route: "/z" },
    };
    const diff = diffInstances([prevX, prevZ], [inst("/x"), inst("/y")]);
    expect(diff.newlyFired.map((i) => i.labels.route)).toEqual(["/y"]);
    expect(diff.nowResolved.map((i) => i.labels.route)).toEqual(["/z"]);
  });

  it("handles empty to empty", () => {
    const diff = diffInstances([], []);
    expect(diff.newlyFired).toEqual([]);
    expect(diff.nowResolved).toEqual([]);
  });
});
