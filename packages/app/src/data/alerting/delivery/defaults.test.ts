import { describe, expect, it } from "vitest";
import { ALERTING_SEVERITY_TIERS, defaultTierFor } from "./defaults";

describe("defaultTierFor", () => {
  it("lets an unsplit destination carry every severity", () => {
    expect(defaultTierFor(["all"], "info")).toBe("all");
    expect(defaultTierFor(new Set(["all", "critical"]), "warning")).toBe("all");
  });

  it("carries a severity only through its own tier while split", () => {
    expect(defaultTierFor(["critical", "warning"], "critical")).toBe(
      "critical",
    );
    expect(defaultTierFor(["critical", "warning"], "info")).toBeNull();
  });

  it("carries nothing through no tiers", () => {
    expect(defaultTierFor([], "critical")).toBeNull();
  });

  it("names the tier the mode assigns when every tier is on offer", () => {
    expect(defaultTierFor(ALERTING_SEVERITY_TIERS, "warning")).toBe("warning");
  });
});
