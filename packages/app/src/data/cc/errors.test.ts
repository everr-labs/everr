import { describe, expect, it } from "vitest";
import { CcApiError, ccErrorInfo } from "./errors";

describe("ccErrorInfo", () => {
  it("decodes a live CcApiError instance", () => {
    const err = new CcApiError(409, "conflict", "referenced by receivers");
    expect(ccErrorInfo(err)).toEqual({
      status: 409,
      code: "conflict",
      message: "referenced by receivers",
    });
  });

  it("decodes the serialized shape a server-fn boundary produces", () => {
    // TanStack Start (seroval) rebuilds a thrown CcApiError as a plain Error
    // carrying the name and the own properties, but not the class identity.
    const wire = Object.assign(new Error("rule was modified concurrently"), {
      name: "CcApiError",
      status: 409,
      code: "conflict",
    });
    expect(wire).not.toBeInstanceOf(CcApiError);
    expect(ccErrorInfo(wire)).toEqual({
      status: 409,
      code: "conflict",
      message: "rule was modified concurrently",
    });
  });

  it("decodes transport-level failures (status 0)", () => {
    const err = new CcApiError(0, "unreachable", "clickety-clack unreachable");
    expect(ccErrorInfo(err)).toMatchObject({ status: 0, code: "unreachable" });
  });

  it("returns null for plain errors and near-misses", () => {
    expect(ccErrorInfo(new Error("boom"))).toBeNull();
    expect(ccErrorInfo("boom")).toBeNull();
    expect(ccErrorInfo(undefined)).toBeNull();
    // Right name, missing fields: not a CC error envelope.
    expect(
      ccErrorInfo(Object.assign(new Error("x"), { name: "CcApiError" })),
    ).toBeNull();
  });
});
