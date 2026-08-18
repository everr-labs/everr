// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isResourceKind, RESOURCE_KINDS } from "./resource-admin.server";

describe("isResourceKind", () => {
  it("accepts the three kinds", () => {
    expect(isResourceKind("dashboard")).toBe(true);
    expect(isResourceKind("runbook")).toBe(true);
    expect(isResourceKind("alert")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isResourceKind("Dashboard")).toBe(false);
    expect(isResourceKind("alertrule")).toBe(false);
    expect(isResourceKind("")).toBe(false);
  });

  it("RESOURCE_KINDS lists exactly the three kinds", () => {
    expect([...RESOURCE_KINDS]).toEqual(["dashboard", "runbook", "alert"]);
  });
});
