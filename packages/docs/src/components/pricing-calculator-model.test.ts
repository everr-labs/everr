import { describe, expect, it } from "vitest";
import { calculateEverrCharges } from "./pricing-calculator-model";

describe("calculateEverrCharges", () => {
  it("includes 300 GB of pooled ingestion and 10 uptime monitors in the base fee", () => {
    expect(
      calculateEverrCharges({ ingestionGb: 300, uptimeMonitors: 10 }),
    ).toEqual({
      baseEur: 39,
      ingestionOverageEur: 0,
      uptimeMonitorsEur: 0,
      totalEur: 39,
    });
  });

  it("charges only for ingestion and monitors beyond their allowances", () => {
    expect(
      calculateEverrCharges({ ingestionGb: 350, uptimeMonitors: 12 }),
    ).toEqual({
      baseEur: 39,
      ingestionOverageEur: 5,
      uptimeMonitorsEur: 2,
      totalEur: 46,
    });
  });
});
