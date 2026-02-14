import { describe, expect, it } from "vitest";
import { calculateCost, formatCost, getRunnerPricing } from "./runner-pricing";

describe("getRunnerPricing", () => {
  it("identifies ubuntu-latest as Linux 2-core", () => {
    const pricing = getRunnerPricing("ubuntu-latest");
    expect(pricing.ratePerMinute).toBe(0.006);
    expect(pricing.os).toBe("linux");
    expect(pricing.isSelfHosted).toBe(false);
    expect(pricing.minuteMultiplier).toBe(1);
    expect(pricing.tier).toBe("Linux 2-core");
  });

  it("identifies windows-latest as Windows 2-core", () => {
    const pricing = getRunnerPricing("windows-latest");
    expect(pricing.ratePerMinute).toBe(0.01);
    expect(pricing.os).toBe("windows");
    expect(pricing.minuteMultiplier).toBe(2);
    expect(pricing.tier).toBe("Windows 2-core");
  });

  it("identifies macos-latest as macOS 3-core", () => {
    const pricing = getRunnerPricing("macos-latest");
    expect(pricing.ratePerMinute).toBe(0.062);
    expect(pricing.os).toBe("macos");
    expect(pricing.minuteMultiplier).toBe(10);
    expect(pricing.tier).toBe("macOS 3-core");
  });

  it("identifies self-hosted runners", () => {
    const pricing = getRunnerPricing("self-hosted,linux,x64");
    expect(pricing.ratePerMinute).toBe(0);
    expect(pricing.isSelfHosted).toBe(true);
    expect(pricing.tier).toBe("Self-Hosted");
  });

  it("identifies self-hosted with custom labels", () => {
    const pricing = getRunnerPricing("self-hosted,gpu,linux");
    expect(pricing.isSelfHosted).toBe(true);
    expect(pricing.ratePerMinute).toBe(0);
  });

  it("identifies larger Linux runners", () => {
    const p4 = getRunnerPricing("ubuntu-latest,4-core");
    expect(p4.ratePerMinute).toBe(0.012);
    expect(p4.tier).toBe("Linux 4-core");

    const p8 = getRunnerPricing("ubuntu-latest,8-core");
    expect(p8.ratePerMinute).toBe(0.022);

    const p16 = getRunnerPricing("ubuntu-latest,16-core");
    expect(p16.ratePerMinute).toBe(0.042);

    const p64 = getRunnerPricing("ubuntu-latest,64-core");
    expect(p64.ratePerMinute).toBe(0.162);
  });

  it("identifies ARM Linux runners", () => {
    const pricing = getRunnerPricing("ubuntu-latest,arm64");
    expect(pricing.ratePerMinute).toBe(0.005);
    expect(pricing.tier).toBe("ARM Linux 2-core");
  });

  it("identifies macOS larger runners", () => {
    const pricing = getRunnerPricing("macos-latest,xlarge");
    expect(pricing.ratePerMinute).toBe(0.077);
    expect(pricing.tier).toBe("macOS 12-core");
  });

  it("returns fallback for unknown labels", () => {
    const pricing = getRunnerPricing("custom-runner-label");
    expect(pricing.ratePerMinute).toBe(0.006);
    expect(pricing.tier).toBe("Unknown");
  });

  it("returns fallback for empty string", () => {
    const pricing = getRunnerPricing("");
    expect(pricing.tier).toBe("Unknown");
  });
});

describe("calculateCost", () => {
  it("rounds minutes up to nearest whole minute", () => {
    const result = calculateCost("ubuntu-latest", 90_000); // 1.5 min
    expect(result.actualMinutes).toBe(1.5);
    expect(result.billingMinutes).toBe(2); // ceil(1.5) * 1x
    expect(result.estimatedCost).toBe(0.012); // 2 * 0.006
  });

  it("applies minute multiplier for Windows", () => {
    const result = calculateCost("windows-latest", 60_000); // 1 min
    expect(result.billingMinutes).toBe(2); // ceil(1) * 2x
    expect(result.estimatedCost).toBe(0.01); // 1 * 0.010
  });

  it("applies minute multiplier for macOS", () => {
    const result = calculateCost("macos-latest", 60_000); // 1 min
    expect(result.billingMinutes).toBe(10); // ceil(1) * 10x
    expect(result.estimatedCost).toBe(0.062); // 1 * 0.062
  });

  it("returns zero cost for self-hosted", () => {
    const result = calculateCost("self-hosted,linux,x64", 300_000); // 5 min
    expect(result.estimatedCost).toBe(0);
    expect(result.actualMinutes).toBe(5);
    expect(result.billingMinutes).toBe(5);
  });

  it("handles very short durations", () => {
    const result = calculateCost("ubuntu-latest", 1000); // 1 second
    expect(result.billingMinutes).toBe(1); // ceil to 1 minute
    expect(result.estimatedCost).toBe(0.006);
  });

  it("uses preRoundedMinutes when provided for per-job billing", () => {
    // 10 jobs of 30s each: totalDurationMs = 300_000 (5 min actual)
    // Without preRoundedMinutes: ceil(5) = 5 billing minutes (wrong)
    // With preRoundedMinutes: 10 jobs * ceil(0.5) = 10 billing minutes (correct)
    const wrong = calculateCost("ubuntu-latest", 300_000);
    expect(wrong.billingMinutes).toBe(5); // ceil(5) * 1x

    const correct = calculateCost("ubuntu-latest", 300_000, 10);
    expect(correct.actualMinutes).toBe(5);
    expect(correct.billingMinutes).toBe(10); // 10 * 1x
    expect(correct.estimatedCost).toBe(0.06); // 10 * 0.006
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats normal values with 2 decimals", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(123.456)).toBe("$123.46");
  });

  it("formats tiny values with 4 decimals", () => {
    expect(formatCost(0.006)).toBe("$0.0060");
    expect(formatCost(0.0012)).toBe("$0.0012");
  });
});
