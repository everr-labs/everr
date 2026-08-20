import { describe, expect, it } from "vitest";
import { isExpectedServerFunctionError } from "./expected-errors";

// Coverage for these messages used to live in the server-fn telemetry test,
// which moved to @everr/tanstack-start-otel. The package takes the predicate
// as an option, so the app's list is asserted here.
describe("isExpectedServerFunctionError", () => {
  it.each([
    "Unauthenticated",
    "No active organization",
    "Alert not found",
  ])("treats %s as control flow", (message) => {
    expect(isExpectedServerFunctionError(new Error(message))).toBe(true);
  });

  it("does not treat an unrelated error as control flow", () => {
    expect(isExpectedServerFunctionError(new Error("boom"))).toBe(false);
  });

  it("ignores non-Error values", () => {
    expect(isExpectedServerFunctionError("Unauthenticated")).toBe(false);
  });
});
