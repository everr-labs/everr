import { describe, expect, it } from "vitest";
import {
  extractInstanceLabels,
  instanceFingerprint,
  NULL_LABEL_VALUE,
  rowsToInstances,
} from "./instances";

describe("extractInstanceLabels", () => {
  it("uses only the stored columns, ignoring the other string cells", () => {
    expect(
      extractInstanceLabels(
        { route: "/x", zone: "eu", error_count: 7, ok: true, n: null },
        ["route"],
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

  // The regression: a SQL NULL and the literal empty string both mapped to
  // "", so two distinct series shared one instance row.
  it("maps an explicit SQL NULL to a value distinct from the empty string", () => {
    expect(extractInstanceLabels({ zone: null }, ["zone"])).toEqual({
      zone: NULL_LABEL_VALUE,
    });
    expect(NULL_LABEL_VALUE).not.toBe("");
    expect(
      instanceFingerprint(extractInstanceLabels({ zone: null }, ["zone"])),
    ).not.toBe(
      instanceFingerprint(extractInstanceLabels({ zone: "" }, ["zone"])),
    );
  });

  // ClickHouse renders a DateTime as a JSON string, so re-deriving identity
  // from the row values made a fresh instance on every evaluation: a rule with
  // `for` never fired, and one without it fired and resolved on every tick.
  it("treats no stored columns as one instance, whatever the row holds", () => {
    expect(
      extractInstanceLabels(
        { value: 3, last_event: "2026-08-11 08:45:00" },
        [],
      ),
    ).toEqual({});
    expect(
      instanceFingerprint(
        extractInstanceLabels({ value: 3, last_event: "08:45" }, []),
      ),
    ).toBe(
      instanceFingerprint(
        extractInstanceLabels({ value: 4, last_event: "08:46" }, []),
      ),
    );
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
      ["route"],
    );
    expect(instances).toHaveLength(2);
    expect(instances[0].labels).toEqual({ route: "/x" });
    expect(instances[0].row).toEqual({ route: "/x", error_count: 9 });
  });

  it("collapses every row into one instance when no columns are stored", () => {
    const instances = rowsToInstances(
      [
        { value: 9, last_event: "08:45" },
        { value: 3, last_event: "08:46" },
      ],
      [],
    );
    expect(instances).toHaveLength(1);
    expect(instances[0].row).toEqual({ value: 9, last_event: "08:45" });
  });
});
