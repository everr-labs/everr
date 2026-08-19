import { describe, expect, it } from "vitest";
import { AlertingError, alertingErrorInfo } from "./errors";

describe("alertingErrorInfo", () => {
  it("decodes a live AlertingError instance", () => {
    const err = new AlertingError(
      409,
      "conflict",
      "referenced by a delivery in flight",
    );
    expect(alertingErrorInfo(err)).toEqual({
      status: 409,
      code: "conflict",
      message: "referenced by a delivery in flight",
    });
  });

  it("decodes the serialized shape a server-fn boundary produces", () => {
    // TanStack Start (seroval) rebuilds a thrown AlertingError as a plain Error
    // carrying the name and the own properties, but not the class identity.
    const wire = Object.assign(new Error("rule was modified concurrently"), {
      name: "AlertingError",
      status: 409,
      code: "conflict",
    });
    expect(wire).not.toBeInstanceOf(AlertingError);
    expect(alertingErrorInfo(wire)).toEqual({
      status: 409,
      code: "conflict",
      message: "rule was modified concurrently",
    });
  });

  it("returns null for plain errors and near-misses", () => {
    expect(alertingErrorInfo(new Error("boom"))).toBeNull();
    expect(alertingErrorInfo("boom")).toBeNull();
    expect(alertingErrorInfo(undefined)).toBeNull();
    // The name alone does not satisfy the serialized error shape.
    expect(
      alertingErrorInfo(
        Object.assign(new Error("x"), { name: "AlertingError" }),
      ),
    ).toBeNull();
  });
});
